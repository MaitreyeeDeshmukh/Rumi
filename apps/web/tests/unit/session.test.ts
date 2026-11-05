import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const SECRET_A = "a".repeat(32);
const SECRET_B = "b".repeat(32);
const NOW = 1_800_000_000_000;
const url = (u = "https://rumi.test/api/plan", cookie?: string): Request => new Request(u, { method: "POST", headers: cookie ? { cookie } : {} });
const cookieValue = (setCookie: string | null): string => (setCookie ?? "").split(";")[0].replace("rumi_sid=", "");

async function load(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const crypto = await import("node:crypto");
  vi.mocked(crypto.timingSafeEqual).mockClear();
  return { session: await import("@/lib/security/session"), crypto };
}

beforeEach(() => vi.stubEnv("NODE_ENV", "test"));
afterEach(() => vi.unstubAllEnvs());

describe("getSession", () => {
  it("issues a signed cookie with an issue time and the right flags when there is none", async () => {
    const { session } = await load({ SESSION_SECRET: SECRET_A });
    const s = session.getSession(url(), NOW);
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.setCookie).toMatch(/^rumi_sid=[0-9a-f-]{36}\.1800000000\.[A-Za-z0-9_-]{43}; /);
    for (const flag of ["Path=/api", "HttpOnly", "Secure", "SameSite=Strict", "Max-Age=86400"]) expect(s.setCookie).toContain(flag);
    expect(s.setCookie).not.toContain(SECRET_A);
  });

  it("accepts its own valid cookie, returns the same id and sets no new cookie", async () => {
    const { session } = await load({ SESSION_SECRET: SECRET_A });
    const first = session.getSession(url(), NOW);
    const again = session.getSession(url(undefined, `other=1; rumi_sid=${cookieValue(first.setCookie)}; x=2`), NOW + 60_000);
    expect(again).toEqual({ id: first.id, setCookie: null });
  });

  it("rejects a cookie older than 24 hours and accepts one just inside the limit", async () => {
    const { session } = await load({ SESSION_SECRET: SECRET_A });
    const first = session.getSession(url(), NOW);
    const cookie = `rumi_sid=${cookieValue(first.setCookie)}`;
    expect(session.getSession(url(undefined, cookie), NOW + 86_400_000).setCookie).toBeNull();
    const expired = session.getSession(url(undefined, cookie), NOW + 86_401_000);
    expect(expired.id).not.toBe(first.id);
    expect(expired.setCookie).not.toBeNull();
  });

  it("rejects a cookie issued in the future and one whose issue time was changed after signing", async () => {
    const { session } = await load({ SESSION_SECRET: SECRET_A });
    const first = session.getSession(url(), NOW);
    const [id, , sig] = cookieValue(first.setCookie).split(".");
    const edited = session.getSession(url(undefined, `rumi_sid=${id}.${1_800_000_000 + 3600}.${sig}`), NOW + 3_600_000);
    expect(edited.id).not.toBe(id);
    const early = session.getSession(url(undefined, `rumi_sid=${cookieValue(first.setCookie)}`), NOW - 3_600_000);
    expect(early.id).not.toBe(first.id);
  });

  it("ignores a forged signature and the old two-part cookie format", async () => {
    const { session } = await load({ SESSION_SECRET: SECRET_A });
    const forged = session.getSession(url(undefined, "rumi_sid=11111111-2222-4333-8444-555555555555.1800000000.WRONG"), NOW);
    expect(forged.id).not.toBe("11111111-2222-4333-8444-555555555555");
    expect(forged.setCookie).not.toBeNull();
    const old = session.getSession(url(undefined, "rumi_sid=11111111-2222-4333-8444-555555555555.WRONG"), NOW);
    expect(old.setCookie).not.toBeNull();
  });

  it("ignores a cookie signed with a different secret", async () => {
    const a = await load({ SESSION_SECRET: SECRET_A });
    const issued = a.session.getSession(url(), NOW);
    const b = await load({ SESSION_SECRET: SECRET_B });
    const checked = b.session.getSession(url(undefined, `rumi_sid=${cookieValue(issued.setCookie)}`), NOW);
    expect(checked.id).not.toBe(issued.id);
    expect(checked.setCookie).not.toBeNull();
  });

  it("does not throw on a signature of the wrong length (timingSafeEqual would)", async () => {
    const { session } = await load({ SESSION_SECRET: SECRET_A });
    const id = "11111111-2222-4333-8444-555555555555";
    for (const bad of ["rumi_sid=abc", "rumi_sid=abc.", "rumi_sid=.sig", `rumi_sid=${id}.1800000000.x`, `rumi_sid=${id}.1800000000.`, "rumi_sid=" + "z".repeat(5000)]) {
      expect(() => session.getSession(url(undefined, bad), NOW)).not.toThrow();
      expect(session.getSession(url(undefined, bad), NOW).setCookie).not.toBeNull();
    }
  });

  it("compares signatures with timingSafeEqual", async () => {
    const { session, crypto } = await load({ SESSION_SECRET: SECRET_A });
    const issued = session.getSession(url(), NOW);
    session.getSession(url(undefined, `rumi_sid=${cookieValue(issued.setCookie)}`), NOW);
    expect(vi.mocked(crypto.timingSafeEqual)).toHaveBeenCalledTimes(1);
  });

  it("rejects an id that is not a uuid even when its signature is valid", async () => {
    const { session } = await load({ SESSION_SECRET: SECRET_A });
    const id = "admin_user_1";
    const sig = createHmac("sha256", SECRET_A).update(`${id}.1800000000`).digest("base64url");
    const s = session.getSession(url(undefined, `rumi_sid=${id}.1800000000.${sig}`), NOW);
    expect(s.id).not.toBe(id);
    expect(s.setCookie).not.toBeNull();
  });

  it("drops Secure only for plain http on localhost", async () => {
    const { session } = await load({ SESSION_SECRET: SECRET_A });
    expect(session.getSession(url("http://localhost:3000/api/plan"), NOW).setCookie).not.toContain("Secure");
    expect(session.getSession(url("http://127.0.0.1:3000/api/plan"), NOW).setCookie).not.toContain("Secure");
    expect(session.getSession(url("https://localhost:3000/api/plan"), NOW).setCookie).toContain("Secure");
    expect(session.getSession(url("http://rumi.test/api/plan"), NOW).setCookie).toContain("Secure");
    expect(session.getSession(url("http://localhost.evil.test/api/plan"), NOW).setCookie).toContain("Secure");
  });

  it("with an unusable secret there is no session at all and nothing throws", async () => {
    const { session } = await load({ SESSION_SECRET: "too short", NODE_ENV: "production" });
    expect(session.getSession(url(), NOW)).toEqual({ id: null, setCookie: null });
    const prod = await load({ SESSION_SECRET: "", NODE_ENV: "production" });
    expect(prod.session.getSession(url(), NOW)).toEqual({ id: null, setCookie: null });
  });
});

describe("signingSecret and hashingKey", () => {
  it("uses a fixed development secret outside production when none is set", async () => {
    const { session } = await load({ SESSION_SECRET: "", NODE_ENV: "development" });
    expect(session.signingSecret()).not.toBe("");
    expect(session.getSession(url(), NOW).id).not.toBeNull();
  });

  it("in production a missing secret is an error, with or without MOCK_AI: the development secret is public", async () => {
    for (const mock of ["", "1"]) {
      const { session } = await load({ SESSION_SECRET: "", NODE_ENV: "production", MOCK_AI: mock });
      expect(() => session.signingSecret()).toThrow();
    }
  });

  it("the address hash still works with no secret, with a random key kept for the process", async () => {
    const { session } = await load({ SESSION_SECRET: "", NODE_ENV: "production" });
    const k = session.hashingKey();
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(session.hashingKey()).toBe(k);
    expect(k).not.toBe("rumi-dev-only-secret-never-used-in-production");
  });

  it("the module can be imported with no configuration at all", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(import("@/lib/security/session")).resolves.toBeDefined();
  });
});

describe("guardRequest with a broken configuration (07 H-16)", () => {
  const same = (): Request => new Request("https://rumi.test/api/plan", { method: "POST", headers: { "sec-fetch-site": "same-origin", "x-real-ip": "203.0.113.7" }, body: "{}" });

  it("serves the request with no session when SESSION_SECRET is unusable, instead of failing", async () => {
    for (const secret of ["too short", " ".repeat(40), ""]) {
      await load({ SESSION_SECRET: secret, NODE_ENV: "production", MOCK_AI: "true", AI_DAILY_USER_LIMIT: "abc" });
      const guard = await import("@/lib/security/guardRequest");
      const r = guard.guardRequest(same());
      expect(r.session).toEqual({ id: null, setCookie: null });
      expect(r.ipHash).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});
