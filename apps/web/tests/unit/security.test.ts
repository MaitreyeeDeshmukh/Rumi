import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/security/origin";
import { clientIp, createRateLimiter, hashClientIp, type RateLimiter } from "@/lib/security/rateLimit";
import { guardRequest } from "@/lib/security/guardRequest";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
const logs = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: auth.requireUser }));
vi.mock("@/lib/log", () => ({ createLogger: () => ({ info: vi.fn(), error: logs.error, warn: logs.warn }) }));

beforeEach(() => {
  // On Vercel the platform writes the forwarding headers; these tests simulate that. Without it they are ignored (see below).
  vi.stubEnv("VERCEL", "1");
  logs.error.mockReset();
  auth.requireUser.mockReset().mockRejectedValue(new AppError("unauthorized"));
  logs.warn.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

const URL_ = "https://rumi.test/api/plan";
const req = (headers: Record<string, string>): Request => new Request(URL_, { method: "POST", headers, body: "{}" });
const status = (fn: () => unknown): number | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.status : -1;
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

describe("clientIp outside Vercel", () => {
  it("ignores every forwarding header, because a client could have written them", () => {
    vi.stubEnv("VERCEL", "");
    const cases: Array<Record<string, string>> = [{ "x-vercel-forwarded-for": "203.0.113.9" }, { "x-real-ip": "203.0.113.7" }, { "x-forwarded-for": "198.51.100.1" }, { "x-forwarded-for": "6.6.6.6, 198.51.100.1", "x-real-ip": "203.0.113.7" }];
    for (const headers of cases) {
      expect(clientIp(req(headers))).toBeNull();
    }
  });

  it("so rotating a spoofed address does not escape the one shared stricter bucket", async () => {
    vi.stubEnv("VERCEL", "");
    const l = createRateLimiter({ now: () => 1 });
    const spoofed = (i: number): Request => new Request("https://rumi.test/api/plan", { method: "POST", headers: { "sec-fetch-site": "same-origin", "x-real-ip": `203.0.113.${i}` }, body: "{}" });
    for (let i = 1; i <= 10; i++) await guardRequest(spoofed(i), { limiter: l });
    const err = await guardRequest(spoofed(11), { limiter: l }).catch((e: unknown) => e);
    expect((err as AppError).status).toBe(429);
  });

  it("on Vercel the same headers are used", () => {
    vi.stubEnv("VERCEL", "1");
    expect(clientIp(req({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
  });
});

describe("clientIp and hashClientIp", () => {
  it("prefers the platform headers, then the LAST x-forwarded-for entry (the one the platform appended)", () => {
    expect(clientIp(req({ "x-vercel-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.7", "x-forwarded-for": "6.6.6.6, 198.51.100.1" }))).toBe("203.0.113.9");
    expect(clientIp(req({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "6.6.6.6, 198.51.100.1" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 198.51.100.1" }))).toBe("198.51.100.1");
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.1" }))).toBe("198.51.100.1");
  });

  it("a client cannot choose its own address by writing the left part of x-forwarded-for", () => {
    const a = clientIp(req({ "x-forwarded-for": "1.1.1.1, 198.51.100.1" }));
    const b = clientIp(req({ "x-forwarded-for": "2.2.2.2, 198.51.100.1" }));
    expect(a).toBe(b);
  });

  it("counts an IPv6 client by its /64 network, in any spelling", () => {
    const a = clientIp(req({ "x-real-ip": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" }));
    const b = clientIp(req({ "x-real-ip": "2001:0db8:0001:0002::1" }));
    const c = clientIp(req({ "x-real-ip": "[2001:db8:1:2:1::]" }));
    expect(a).toBe("v6:2001:db8:1:2");
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(clientIp(req({ "x-real-ip": "2001:db8:1:3::1" }))).not.toBe(a);
    expect(clientIp(req({ "x-real-ip": "::ffff:203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-real-ip": "fe80::1%eth0" }))).toBe("v6:fe80:0:0:0");
  });

  it("returns null for junk that is not an address", () => {
    expect(clientIp(req({ "x-real-ip": "<script>", "x-forwarded-for": "198.51.100.1" }))).toBe("198.51.100.1");
    expect(clientIp(req({ "x-real-ip": "a".repeat(100) }))).toBeNull();
    expect(clientIp(req({ "x-real-ip": "999.1.1.1" }))).toBeNull();
    expect(clientIp(req({}))).toBeNull();
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
    for (let i = 0; i < 50; i++) {
      c.advance(100);
      expect(hit(l, "ipA")).toBe(false);
    }
    c.advance(55_001); // 60,001 ms after the two allowed requests
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
  const alice = { userId: "00000000-0000-4000-8000-00000000000a", userHash: "a".repeat(16), isAnonymous: true };
  const catchError = async (fn: () => Promise<unknown>): Promise<AppError> => {
    try {
      await fn();
    } catch (e) {
      if (e instanceof AppError) return e;
      throw e;
    }
    throw new Error("expected an AppError");
  };

  it("passes a well formed signed-out request with a hashed address and no user", async () => {
    const r = await guardRequest(good(), { limiter: fresh() });
    expect(r.user).toBeNull();
    expect(r.ipHash).toBe(hashClientIp("203.0.113.7"));
  });

  it("returns the user that requireUser verified and ignores any id or recovery code the client sends", async () => {
    auth.requireUser.mockResolvedValue(alice);
    const req = good({ "x-user-id": "00000000-0000-4000-8000-00000000000b", "x-rumi-key": "not a code at all" });
    const r = await guardRequest(req, { limiter: fresh() });
    expect(r.user).toEqual(alice);
    expect(auth.requireUser).toHaveBeenCalledWith(req);
  });

  it("refuses a foreign origin with 403 before it touches the limiter or the auth server", async () => {
    let checked = 0;
    const spy: RateLimiter = { check: () => ((checked += 1), { ok: true }), checkUser: () => ({ ok: true }), tracked: () => ({ ips: 0, sessions: 0 }) };
    const err = await catchError(() => guardRequest(new Request(URL_, { method: "POST", headers: { origin: "https://evil.test" } }), { limiter: spy }));
    expect(err.status).toBe(403);
    expect([checked, auth.requireUser.mock.calls.length]).toEqual([0, 0]);
  });

  it("returns 429 with the retry time from the limiter", async () => {
    const l = createRateLimiter({ now: () => 5, limits: { perIp: 1 } });
    await guardRequest(good(), { limiter: l });
    const err = await catchError(() => guardRequest(good(), { limiter: l }));
    expect([err.status, err.code, err.retryAfterSec]).toEqual([429, "rate_limited", 60]);
  });

  it("counts a signed-in user by their hash, so a second address does not reset the limit", async () => {
    auth.requireUser.mockResolvedValue(alice);
    const l = createRateLimiter({ now: () => 1, limits: { perSession: 2, perIp: 100 } });
    await guardRequest(good({ "x-real-ip": "203.0.113.1" }), { limiter: l });
    await guardRequest(good({ "x-real-ip": "203.0.113.2" }), { limiter: l });
    expect((await catchError(() => guardRequest(good({ "x-real-ip": "203.0.113.3" }), { limiter: l }))).status).toBe(429);
  });

  it("refuses a declared body that is too large or not a number", async () => {
    expect((await catchError(() => guardRequest(good({ "content-length": "64001" }), { limiter: fresh() }))).status).toBe(413);
    expect((await guardRequest(good({ "content-length": "64000" }), { limiter: fresh() })).user).toBeNull();
    expect((await catchError(() => guardRequest(good({ "content-length": "10" }), { limiter: fresh(), maxBytes: 5 }))).status).toBe(413);
    expect((await catchError(() => guardRequest(good({ "content-length": "-1" }), { limiter: fresh() }))).status).toBe(400);
  });

  it("requireAuth: a signed-out caller gets 401, counted by address only, never as a user", async () => {
    let checked = 0;
    let userChecks = 0;
    const spy: RateLimiter = { check: () => ((checked += 1), { ok: true }), checkUser: () => ((userChecks += 1), { ok: true }), tracked: () => ({ ips: 0, sessions: 0 }) };
    const err = await catchError(() => guardRequest(good(), { limiter: spy, requireAuth: true }));
    expect([err.status, err.code, checked, userChecks]).toEqual([401, "unauthorized", 1, 0]);
  });

  it("the address limit runs BEFORE the Auth call: a limited address never reaches Supabase", async () => {
    const l = createRateLimiter({ now: () => 5, limits: { perIp: 1 } });
    await guardRequest(good(), { limiter: l });
    auth.requireUser.mockClear();
    const err = await catchError(() => guardRequest(good(), { limiter: l }));
    expect(err.status).toBe(429);
    expect(auth.requireUser).not.toHaveBeenCalled();
  });

  it("a signed-in request counts once against the address and once against the user", async () => {
    auth.requireUser.mockResolvedValue(alice);
    const l = createRateLimiter({ now: () => 1, limits: { perIp: 2, perSession: 100 } });
    await guardRequest(good(), { limiter: l });
    await guardRequest(good(), { limiter: l });
    expect((await catchError(() => guardRequest(good(), { limiter: l }))).status).toBe(429);
  });

  it("a configuration fault in auth is logged at ERROR with the code only, and the caller is served signed out", async () => {
    auth.requireUser.mockRejectedValue(new AppError("config"));
    const r = await guardRequest(good(), { limiter: fresh() });
    expect(r.user).toBeNull();
    expect(logs.error).toHaveBeenCalledWith("auth_unverified", expect.any(AppError), { code: "config" });
    expect(logs.warn).not.toHaveBeenCalled();
  });

  it("requireAuth: an unreachable auth server is a 503, not a 401", async () => {
    auth.requireUser.mockRejectedValue(new AppError("store_unavailable"));
    const err = await catchError(() => guardRequest(good(), { limiter: fresh(), requireAuth: true }));
    expect([err.status, err.code]).toEqual([503, "store_unavailable"]);
  });

  it("without requireAuth an auth outage serves the caller as signed out and leaves one warning with the code only", async () => {
    auth.requireUser.mockRejectedValue(new AppError("store_unavailable"));
    const r = await guardRequest(good(), { limiter: fresh() });
    expect(r.user).toBeNull();
    expect(logs.warn).toHaveBeenCalledWith("auth_unverified", { code: "store_unavailable" });
  });

  it("a plain signed-out caller is not logged: it is a normal state", async () => {
    await guardRequest(good(), { limiter: fresh() });
    expect(logs.warn).not.toHaveBeenCalled();
  });
});

describe("guardRequest never throws a plain Error (07 H-16)", () => {
  const good = (): Request => new Request(URL_, { method: "POST", headers: { "sec-fetch-site": "same-origin", "x-real-ip": "203.0.113.7" }, body: "{}" });

  it("turns an unexpected failure into a fixed AppError and keeps only the cause", async () => {
    const boom: RateLimiter = {
      check: () => {
        throw new Error("secret detail user text sk-123");
      },
      checkUser: () => ({ ok: true }),
      tracked: () => ({ ips: 0, sessions: 0 }),
    };
    const err = await guardRequest(good(), { limiter: boom }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect([(err as AppError).status, (err as AppError).code]).toEqual([500, "internal"]);
    expect((err as AppError).message).not.toContain("secret");
  });

  it("an unexpected throw from requireUser is also turned into a fixed AppError", async () => {
    auth.requireUser.mockRejectedValue(new Error("secret detail"));
    const err = await guardRequest(good(), { limiter: createRateLimiter({ now: () => 1 }) }).catch((e: unknown) => e);
    expect([(err as AppError).code, (err as AppError).message]).toEqual(["internal", "internal"]);
  });

  it("a request with no readable address is still served (shared stricter bucket)", async () => {
    const r = new Request(URL_, { method: "POST", headers: { "sec-fetch-site": "same-origin" }, body: "{}" });
    expect((await guardRequest(r, { limiter: createRateLimiter({ now: () => 1 }) })).ipHash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("rate limit details (07 H-15, H-17)", () => {
  const hit = (l: RateLimiter, ip: string, session: string | null = null, unknown = false): boolean => l.check(ip, session, unknown).ok;

  it("a request whose address cannot be read shares one bucket with a stricter limit of 10", () => {
    const l = createRateLimiter({ now: () => 1 });
    for (let i = 0; i < 10; i++) expect(hit(l, "unknownhash", null, true)).toBe(true);
    expect(l.check("unknownhash", null, true)).toMatchObject({ ok: false, scope: "ip" });
    // a normal address still gets 30
    for (let i = 0; i < 30; i++) expect(hit(l, "normalhash")).toBe(true);
    expect(hit(l, "normalhash")).toBe(false);
  });

  it("the window edge: a hit expires at exactly windowMs and not one millisecond earlier", () => {
    let t = 1_000;
    const l = createRateLimiter({ now: () => t, limits: { perIp: 1 } });
    expect(hit(l, "edge")).toBe(true);
    t = 1_000 + 59_999;
    expect(hit(l, "edge")).toBe(false);
    t = 1_000 + 60_000;
    expect(hit(l, "edge")).toBe(true);
  });

  it("refused requests from new addresses do not create entries, so the map cannot be filled by refusals", () => {
    const l = createRateLimiter({ now: () => 1, limits: { perInstance: 1, maxKeys: 3 } });
    expect(hit(l, "first")).toBe(true);
    // the instance window is full: every further request is refused and none may be stored
    for (let i = 0; i < 50; i++) expect(hit(l, `flood${i}`)).toBe(false);
    const roomy = createRateLimiter({ now: () => 1, limits: { maxKeys: 3 } });
    expect(hit(roomy, "keep")).toBe(true);
    for (let i = 0; i < 50; i++) hit(roomy, "keep");
    // "keep" is at its limit; refusals on other keys must not push it out
    const limited = createRateLimiter({ now: () => 1, limits: { perIp: 1, perSession: 1, maxKeys: 2 } });
    expect(hit(limited, "keep", "s")).toBe(true);
    for (let i = 0; i < 20; i++) expect(hit(limited, `other${i}`, "s")).toBe(false);
    expect(hit(limited, "keep", "t")).toBe(false);
  });
});

describe("assertSameOrigin: scheme", () => {
  const post = (u: string, headers: Record<string, string>): Request => new Request(u, { method: "POST", headers, body: "{}" });
  it("rejects an origin that is not http or https", () => {
    expect(status(() => assertSameOrigin(post("https://rumi.test/api/plan", { origin: "ftp://rumi.test" })))).toBe(403);
    expect(status(() => assertSameOrigin(post("https://rumi.test/api/plan", { origin: "chrome-extension://rumi.test" })))).toBe(403);
  });
  it("an https request needs an https origin; plain http is accepted only when the request itself is plain http", () => {
    expect(status(() => assertSameOrigin(post("https://rumi.test/api/plan", { origin: "http://rumi.test" })))).toBe(403);
    expect(status(() => assertSameOrigin(post("https://rumi.test/api/plan", { origin: "https://rumi.test" })))).toBeUndefined();
    expect(status(() => assertSameOrigin(post("http://localhost:3000/api/plan", { origin: "http://localhost:3000" })))).toBeUndefined();
    expect(status(() => assertSameOrigin(post("http://rumi.test/api/plan", { origin: "http://rumi.test", "x-forwarded-proto": "https" })))).toBe(403);
    expect(status(() => assertSameOrigin(post("http://rumi.test/api/plan", { origin: "https://rumi.test", "x-forwarded-proto": "https" })))).toBeUndefined();
  });
});

describe("rules pinned by mutation checks", () => {
  it("the limiter tracks at most maxKeys addresses and sessions, and refusals add nothing", () => {
    const l = createRateLimiter({ now: () => 1, limits: { perInstance: 2, maxKeys: 3 } });
    expect(l.check("a", "s1").ok).toBe(true);
    expect(l.check("b", "s2").ok).toBe(true);
    for (let i = 0; i < 100; i++) expect(l.check(`flood${i}`, `fs${i}`).ok).toBe(false);
    expect(l.tracked()).toEqual({ ips: 2, sessions: 2 });
    const small = createRateLimiter({ now: () => 1, limits: { maxKeys: 3 } });
    for (let i = 0; i < 100; i++) small.check(`ip${i}`, `s${i}`);
    expect(small.tracked()).toEqual({ ips: 3, sessions: 3 });
  });

  it("guardRequest gives a request with no readable address the stricter shared limit", async () => {
    const l = createRateLimiter({ now: () => 1 });
    const anon = (): Request => new Request(URL_, { method: "POST", headers: { "sec-fetch-site": "same-origin" }, body: "{}" });
    for (let i = 0; i < 10; i++) await guardRequest(anon(), { limiter: l });
    const err = await guardRequest(anon(), { limiter: l }).catch((e: unknown) => e);
    expect((err as AppError).status).toBe(429);
  });

  it("an origin with another scheme is refused even when the host matches", () => {
    const post = (headers: Record<string, string>): Request => new Request("http://localhost:3000/api/plan", { method: "POST", headers, body: "{}" });
    expect(status(() => assertSameOrigin(post({ origin: "ftp://localhost:3000" })))).toBe(403);
    expect(status(() => assertSameOrigin(post({ origin: "chrome-extension://localhost:3000" })))).toBe(403);
    expect(status(() => assertSameOrigin(post({ origin: "http://localhost:3000" })))).toBeUndefined();
  });
});
