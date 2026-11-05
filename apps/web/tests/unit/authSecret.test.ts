import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


// The first import of the Supabase libraries is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });
const SECRET_A = "a".repeat(32);
const SECRET_B = "b".repeat(32);
const UID = "00000000-0000-4000-8000-0000000000aa";

const logs = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
const fake = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: () => Promise.resolve({ auth: { getUser: () => Promise.resolve({ data: { user: { id: fake.id, is_anonymous: true } }, error: null }) } }) }));
vi.mock("@/lib/log", () => ({ createLogger: () => ({ info: vi.fn(), error: logs.error, warn: logs.warn }) }));

async function load(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return { secret: await import("@/lib/auth/secret"), user: await import("@/lib/auth/requireUser") };
}

beforeEach(() => vi.stubEnv("NODE_ENV", "test"));
afterEach(() => vi.unstubAllEnvs());

describe("hashSecret and hashingKey", () => {
  it("uses a fixed development secret outside production when none is set", async () => {
    const { secret } = await load({ SESSION_SECRET: "", NODE_ENV: "development" });
    expect(secret.hashSecret()).not.toBe("");
  });

  it("in production a missing secret is an error, with or without MOCK_AI: the development secret is public", async () => {
    for (const mock of ["", "1"]) {
      const { secret } = await load({ SESSION_SECRET: "", NODE_ENV: "production", MOCK_AI: mock });
      expect(() => secret.hashSecret()).toThrow();
    }
  });

  it("the address hash still works with no secret, with a random key kept for the process", async () => {
    const { secret } = await load({ SESSION_SECRET: "", NODE_ENV: "production" });
    const k = secret.hashingKey();
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(secret.hashingKey()).toBe(k);
    expect(k).not.toBe("rumi-dev-only-secret-never-used-in-production");
  });

  it("an unusable secret in production is logged once at ERROR, with the code only, and the address hash keeps working", async () => {
    logs.error.mockReset();
    const { secret } = await load({ SESSION_SECRET: "too short", NODE_ENV: "production" });
    const k = secret.hashingKey();
    expect(secret.hashingKey()).toBe(k);
    expect(logs.error).toHaveBeenCalledTimes(1);
    expect(logs.error).toHaveBeenCalledWith("session_secret_unusable", expect.anything(), { code: "config" });
    expect(JSON.stringify(logs.error.mock.calls)).not.toContain("too short");
  });

  it("a usable secret logs nothing", async () => {
    logs.error.mockReset();
    const { secret } = await load({ SESSION_SECRET: SECRET_A });
    secret.hashingKey();
    expect(logs.error).not.toHaveBeenCalled();
  });

  it("the module can be imported with no configuration at all", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(import("@/lib/auth/secret")).resolves.toBeDefined();
  });
});

describe("userHash (from requireUser)", () => {
  const hashOf = async (env: Record<string, string>, id: string): Promise<string> => {
    const { user } = await load(env);
    fake.id = id;
    return (await user.requireUser(new Request("https://rumi.test/api/x"))).userHash;
  };

  it("is 16 hex characters, stable, different per user and per secret, and never contains the id", async () => {
    const h = await hashOf({ SESSION_SECRET: SECRET_A }, UID);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(await hashOf({ SESSION_SECRET: SECRET_A }, UID)).toBe(h);
    expect(await hashOf({ SESSION_SECRET: SECRET_A }, "00000000-0000-4000-8000-0000000000ab")).not.toBe(h);
    expect(UID.includes(h)).toBe(false);
    expect(await hashOf({ SESSION_SECRET: SECRET_B }, UID)).not.toBe(h);
  });

  it("in production without a usable secret it is a config error, not a weak hash", async () => {
    for (const secret of ["", "too short"]) {
      await expect(hashOf({ SESSION_SECRET: secret, NODE_ENV: "production" }, UID)).rejects.toMatchObject({ code: "config" });
    }
  });
});

describe("guardRequest with a broken configuration (07 H-16)", () => {
  const same = (): Request => new Request("https://rumi.test/api/plan", { method: "POST", headers: { "sec-fetch-site": "same-origin", "x-real-ip": "203.0.113.7" }, body: "{}" });

  it("serves a signed-out request instead of failing when SESSION_SECRET and Supabase are unusable", async () => {
    for (const secret of ["too short", " ".repeat(40), ""]) {
      await load({ SESSION_SECRET: secret, NODE_ENV: "production", MOCK_AI: "true", AI_DAILY_USER_LIMIT: "abc", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" });
      const guard = await import("@/lib/security/guardRequest");
      const r = await guard.guardRequest(same());
      expect(r.user).toBeNull();
      expect(r.ipHash).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(logs.error).toHaveBeenCalledWith("auth_unverified", expect.anything(), { code: "config" });
  });
});
