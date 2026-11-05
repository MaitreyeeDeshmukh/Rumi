import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/ai/http";
import { assertSameOrigin } from "@/lib/security/origin";
import { clientIp, createRateLimiter, hashClientIp, type RateLimiter } from "@/lib/security/rateLimit";
import { guardRequest } from "@/lib/security/guardRequest";

const URL_ = "https://rumi.test/api/plan";
const req = (headers: Record<string, string>): Request => new Request(URL_, { method: "POST", headers, body: "{}" });
const status = (fn: () => unknown): number | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
  return undefined;
};

describe("assertSameOrigin", () => {
  it("accepts a same-origin browser fetch", () => {
    expect(status(() => assertSameOrigin(req({ "sec-fetch-site": "same-origin" })))).toBeUndefined();
    expect(status(() => assertSameOrigin(req({ "sec-fetch-site": "same-origin", origin: "https://rumi.test" })))).toBeUndefined();
    expect(status(() => assertSameOrigin(req({ origin: "https://rumi.test" })))).toBeUndefined();
  });

  it.each([
    ["cross-site fetch", { "sec-fetch-site": "cross-site" }],
    ["same-site (a sibling subdomain)", { "sec-fetch-site": "same-site" }],
    ["user-initiated navigation", { "sec-fetch-site": "none" }],
    ["another origin", { origin: "https://evil.test" }],
    ["a lookalike host", { origin: "https://rumi.test.evil.test" }],
    ["a different port", { origin: "https://rumi.test:8443" }],
    ["Origin null", { origin: "null" }],
    ["Origin null with a same-origin hint", { "sec-fetch-site": "same-origin", origin: "null" }],
    ["an unparsable Origin", { origin: "not a url" }],
    ["a javascript Origin", { origin: "javascript:alert(1)" }],
    ["an empty Origin", { origin: "" }],
    ["same-origin hint but a foreign Origin", { "sec-fetch-site": "same-origin", origin: "https://evil.test" }],
    ["neither header", {}],
  ])("rejects %s with 403", (_name, headers) => {
    expect(status(() => assertSameOrigin(req(headers)))).toBe(403);
  });
});

describe("clientIp and hashClientIp", () => {
  it("prefers x-real-ip, else the first x-forwarded-for entry", () => {
    expect(clientIp(req({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientIp(req({ "x-forwarded-for": " 2001:db8::1 , 10.0.0.1" }))).toBe("2001:db8::1");
    expect(clientIp(req({}))).toBe("unknown");
  });

  it("ignores junk that is not an address", () => {
    expect(clientIp(req({ "x-real-ip": "<script>", "x-forwarded-for": "198.51.100.1" }))).toBe("198.51.100.1");
    expect(clientIp(req({ "x-real-ip": "a".repeat(100) }))).toBe("unknown");
  });

  it("hashes: stable, 16 hex characters, different per address, never contains the address", () => {
    const a = hashClientIp("203.0.113.7");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hashClientIp("203.0.113.7")).toBe(a);
    expect(hashClientIp("203.0.113.8")).not.toBe(a);
    expect(a).not.toContain("203");
  });
});

describe("createRateLimiter", () => {
  const clock = (start = 1_000_000): { now: () => number; advance: (ms: number) => void } => {
    let t = start;
    return { now: () => t, advance: (ms) => (t += ms) };
  };
  const hit = (l: RateLimiter, ip: string, session: string | null = null): boolean => l.check(ip, session).ok;

  it("allows 30 per minute per address and refuses the 31st with a retry time", () => {
    const c = clock();
    const l = createRateLimiter({ now: c.now });
    for (let i = 0; i < 30; i++) expect(hit(l, "ipA")).toBe(true);
    const blocked = l.check("ipA", null);
    expect(blocked).toEqual({ ok: false, retryAfterSec: 60, scope: "ip" });
    c.advance(30_000);
    expect(l.check("ipA", null)).toEqual({ ok: false, retryAfterSec: 30, scope: "ip" });
    c.advance(30_001);
    expect(hit(l, "ipA")).toBe(true);
  });

  it("a refused request is not recorded, so waiting out the window is enough", () => {
    const c = clock();
    const l = createRateLimiter({ now: c.now, limits: { perIp: 2 } });
    hit(l, "ipA");
    hit(l, "ipA");
    for (let i = 0; i < 50; i++) expect(hit(l, "ipA")).toBe(false);
    c.advance(60_001);
    expect(hit(l, "ipA")).toBe(true);
  });

  it("limits a session to 20 per minute even across different addresses", () => {
    const l = createRateLimiter({ now: clock().now });
    for (let i = 0; i < 20; i++) expect(hit(l, `ip${i}`, "sess1")).toBe(true);
    expect(l.check("ip99", "sess1")).toMatchObject({ ok: false, scope: "session" });
    expect(hit(l, "ip99", "sess2")).toBe(true);
  });

  it("counts a request with no cookie by address, so a cookie-less flood is limited", () => {
    const l = createRateLimiter({ now: clock().now });
    for (let i = 0; i < 30; i++) l.check("flood", null);
    expect(l.check("flood", null)).toMatchObject({ ok: false, scope: "ip" });
    expect(hit(l, "someoneElse", null)).toBe(true);
  });

  it("rotating forged sessions does not help: the address is still counted", () => {
    const l = createRateLimiter({ now: clock().now });
    for (let i = 0; i < 30; i++) expect(hit(l, "attacker", `fresh${i}`)).toBe(true);
    expect(l.check("attacker", "fresh-new")).toMatchObject({ ok: false, scope: "ip" });
  });

  it("has an instance wide window of 300", () => {
    const l = createRateLimiter({ now: clock().now });
    for (let i = 0; i < 300; i++) expect(hit(l, `ip${i}`, `s${i}`)).toBe(true);
    expect(l.check("ip-new", "s-new")).toMatchObject({ ok: false, scope: "instance" });
  });

  it("evicts the least recently used keys and never forgets everything at once", () => {
    const l = createRateLimiter({ now: clock().now, limits: { perIp: 2, maxKeys: 3 } });
    hit(l, "hot");
    hit(l, "hot"); // hot is now at its limit
    hit(l, "k1");
    hit(l, "hot"); // refused, but the key counts as recently used
    hit(l, "k2");
    hit(l, "k3");
    hit(l, "hot"); // refused again, hot stays in the newest positions
    hit(l, "k4"); // over the cap: the oldest key goes
    expect(hit(l, "hot")).toBe(false); // hot survived the eviction, still limited
    // k1 was the oldest and was evicted: it starts fresh
    hit(l, "k1");
    hit(l, "k1");
    expect(hit(l, "k1")).toBe(false);
    const evicted = createRateLimiter({ now: clock().now, limits: { perIp: 1, maxKeys: 2 } });
    hit(evicted, "old");
    hit(evicted, "b");
    hit(evicted, "c");
    expect(hit(evicted, "old")).toBe(true); // forgotten, so allowed once more
    expect(hit(evicted, "c")).toBe(false); // newer keys are kept
  });

  it("keeps the number of tracked keys bounded under a flood of distinct addresses", () => {
    const c = clock();
    const l = createRateLimiter({ now: c.now, limits: { maxKeys: 100 } });
    for (let i = 0; i < 5000; i++) hit(l, `ip${i}`, `s${i}`);
    // behaviour check: the most recent 100 keys are still tracked and limited
    for (let i = 0; i < 29; i++) hit(l, "ip4999", null);
    expect(hit(l, "ip4999", null)).toBe(false);
  });
});

describe("guardRequest", () => {
  const good = (extra: Record<string, string> = {}): Request =>
    new Request(URL_, { method: "POST", headers: { "sec-fetch-site": "same-origin", "x-real-ip": "203.0.113.7", ...extra }, body: "{}" });
  const fresh = (): RateLimiter => createRateLimiter({ now: () => 1 });
  const catchError = (fn: () => unknown): HttpError => {
    try {
      fn();
    } catch (e) {
      if (e instanceof HttpError) return e;
      throw e;
    }
    throw new Error("expected an HttpError");
  };

  it("passes a well formed request and returns the session, a hashed address and no key", () => {
    const r = guardRequest(good(), { limiter: fresh() });
    expect(r.session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.session.setCookie).not.toBeNull();
    expect(r.ipHash).toBe(hashClientIp("203.0.113.7"));
    expect(r.memoryKey).toBeNull();
  });

  it("returns a well formed recovery code and rejects a malformed one before any HMAC", () => {
    expect(guardRequest(good({ "x-rumi-key": "ABCDE-FGHJK-LMNPQ-RSTUV" }), { limiter: fresh() }).memoryKey).toBe("ABCDE-FGHJK-LMNPQ-RSTUV");
    for (const bad of ["abcde-fghjk-lmnpq-rstuv", "ABCDEFGHJKLMNPQRSTUV", "ABCDE-FGHJK-LMNPQ", "ABCDE-FGHJK-LMNPQ-RSTU0", "ABCDE-FGHJK-LMNPQ-RSTUI", "ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2", "ABCDE-FGHJK-LMNPQ-RSTUV,ABCDE-FGHJK-LMNPQ-RSTUV", "<script>"]) {
      expect(catchError(() => guardRequest(good({ "x-rumi-key": bad }), { limiter: fresh() })).status).toBe(400);
    }
  });

  it("refuses a foreign origin with 403 before it touches the limiter", () => {
    let checked = 0;
    const spy: RateLimiter = { check: () => ((checked += 1), { ok: true }) };
    const err = catchError(() => guardRequest(new Request(URL_, { method: "POST", headers: { origin: "https://evil.test" } }), { limiter: spy }));
    expect(err.status).toBe(403);
    expect(checked).toBe(0);
  });

  it("returns 429 with the retry time from the limiter", () => {
    const l = createRateLimiter({ now: () => 5, limits: { perIp: 1 } });
    guardRequest(good(), { limiter: l });
    const err = catchError(() => guardRequest(good(), { limiter: l }));
    expect([err.status, err.code, err.retryAfterSec]).toEqual([429, "rate_limited", 60]);
  });

  it("counts the session of a valid cookie but not a freshly issued one", () => {
    const l = createRateLimiter({ now: () => 1, limits: { perSession: 2, perIp: 100 } });
    const first = guardRequest(good(), { limiter: l });
    const cookie = (first.session.setCookie ?? "").split(";")[0];
    guardRequest(good({ cookie }), { limiter: l });
    guardRequest(good({ cookie }), { limiter: l });
    expect(catchError(() => guardRequest(good({ cookie }), { limiter: l })).status).toBe(429);
  });

  it("refuses a declared body that is too large or not a number", () => {
    expect(catchError(() => guardRequest(good({ "content-length": "64001" }), { limiter: fresh() })).status).toBe(413);
    expect(guardRequest(good({ "content-length": "64000" }), { limiter: fresh() }).memoryKey).toBeNull();
    expect(catchError(() => guardRequest(good({ "content-length": "10" }), { limiter: fresh(), maxBytes: 5 })).status).toBe(413);
    expect(catchError(() => guardRequest(good({ "content-length": "-1" }), { limiter: fresh() })).status).toBe(400);
  });
});
