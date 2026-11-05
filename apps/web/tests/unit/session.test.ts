import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const SECRET_A = "a".repeat(32);
const SECRET_B = "b".repeat(32);
const withCookie = (cookie: string): Request => new Request("https://rumi.test/api/plan", { method: "POST", headers: { cookie } });
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
  it("issues a signed cookie with the right flags when there is none", async () => {
    const { session } = await load({ SESSION_SECRET: SECRET_A });
    const s = session.getSession(new Request("https://rumi.test/api/plan"));
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.setCookie).toMatch(/^rumi_sid=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}; /);
    for (const flag of ["Path=/api", "HttpOnly", "Secure", "SameSite=Strict", "Max-Age=86400"]) expect(s.setCookie).toContain(flag);
    expect(s.setCookie).not.toContain(SECRET_A);
  });

  it("accepts its own valid cookie, returns the same id and sets no new cookie", async () => {
    const { session } = await load({ SESSION_SECRET: SECRET_A });
    const first = session.getSession(new Request("https://rumi.test/api/plan"));
    const again = session.getSession(withCookie(`other=1; rumi_sid=${cookieValue(first.setCookie)}; x=2`));
    expect(again).toEqual({ id: first.id, setCookie: null });
  });

  it("ignores a forged signature and issues a new id", async () => {
    const { session } = await load({ SESSION_SECRET: SECRET_A });
    const forged = session.getSession(withCookie("rumi_sid=11111111-2222-4333-8444-555555555555.WRONG"));
    expect(forged.id).not.toBe("11111111-2222-4333-8444-555555555555");
    expect(forged.setCookie).not.toBeNull();
  });

  it("ignores a cookie signed with a different secret", async () => {
    const a = await load({ SESSION_SECRET: SECRET_A });
    const issued = a.session.getSession(new Request("https://rumi.test/api/plan"));
    const b = await load({ SESSION_SECRET: SECRET_B });
    const checked = b.session.getSession(withCookie(`rumi_sid=${cookieValue(issued.setCookie)}`));
    expect(checked.id).not.toBe(issued.id);
    expect(checked.setCookie).not.toBeNull();
  });

  it("does not throw on a signature of the wrong length (timingSafeEqual would)", async () => {
    const { session } = await load({ SESSION_SECRET: SECRET_A });
    for (const bad of ["rumi_sid=abc", "rumi_sid=abc.", "rumi_sid=.sig", "rumi_sid=11111111-2222-4333-8444-555555555555.x", "rumi_sid=" + "z".repeat(5000)]) {
      expect(() => session.getSession(withCookie(bad))).not.toThrow();
      expect(session.getSession(withCookie(bad)).setCookie).not.toBeNull();
    }
  });

  it("compares signatures with timingSafeEqual", async () => {
    const { session, crypto } = await load({ SESSION_SECRET: SECRET_A });
    const issued = session.getSession(new Request("https://rumi.test/api/plan"));
    session.getSession(withCookie(`rumi_sid=${cookieValue(issued.setCookie)}`));
    expect(vi.mocked(crypto.timingSafeEqual)).toHaveBeenCalledTimes(1);
  });

  it("rejects an id that is not a uuid even when its signature is valid", async () => {
    const { session } = await load({ SESSION_SECRET: SECRET_A });
    const id = "../../admin";
    const sig = createHmac("sha256", SECRET_A).update(id).digest("base64url");
    const s = session.getSession(withCookie(`rumi_sid=${id}.${sig}`));
    expect(s.id).not.toBe(id);
    expect(s.setCookie).not.toBeNull();
  });
});

describe("signingSecret", () => {
  it("uses a fixed development secret outside production when none is set", async () => {
    const { session } = await load({ SESSION_SECRET: "", NODE_ENV: "development" });
    expect(session.signingSecret()).not.toBe("");
    expect(() => session.getSession(new Request("https://rumi.test/api/plan"))).not.toThrow();
  });

  it("with MOCK_AI=1 a production build still starts without a secret", async () => {
    const { session } = await load({ SESSION_SECRET: "", NODE_ENV: "production", MOCK_AI: "1" });
    expect(() => session.signingSecret()).not.toThrow();
  });

  it("in production without MOCK_AI a missing secret is an error, never a silent default", async () => {
    const { session } = await load({ SESSION_SECRET: "", NODE_ENV: "production", MOCK_AI: "" });
    expect(() => session.signingSecret()).toThrow(/SESSION_SECRET/);
    expect(() => session.getSession(new Request("https://rumi.test/api/plan"))).toThrow();
  });

  it("the module can be imported with no configuration at all", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(import("@/lib/security/session")).resolves.toBeDefined();
  });
});
