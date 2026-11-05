import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/lib/env";

const SECRET = "x".repeat(32);

describe("parseEnv", () => {
  it("accepts an empty environment", () => {
    expect(parseEnv({})).toEqual({});
  });

  it("treats empty strings as unset", () => {
    expect(parseEnv({ GROQ_API_KEY: "" })).toEqual({});
  });

  it("rejects a malformed URL and names the variable without echoing its value", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    try {
      parseEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url" });
    } catch (e) {
      expect(String(e)).not.toContain("not a url");
    }
  });

  it("requires signing secrets to be at least 32 characters and never echoes them", () => {
    expect(() => parseEnv({ SESSION_SECRET: "short-secret" })).toThrow(/SESSION_SECRET/);
    // The Supermemory variables are gone: setting them is ignored, not validated.
    expect(parseEnv({ MEMORY_TAG_SECRET: "y", SUPERMEMORY_API_KEY: "z" })).toEqual({});
    expect(parseEnv({ SESSION_SECRET: SECRET }).SESSION_SECRET).toBe(SECRET);
    try {
      parseEnv({ SESSION_SECRET: "short-secret" });
    } catch (e) {
      expect(String(e)).not.toContain("short-secret");
    }
  });

  it("only accepts 1 or 0 for the on/off switches, so a typo is caught", () => {
    expect(parseEnv({ MOCK_AI: "1" }).MOCK_AI).toBe("1");
    expect(() => parseEnv({ MOCK_AI: "yes" })).toThrow(/MOCK_AI/);
    expect(() => parseEnv({ MEMORY_ENABLED: "true" })).toThrow(/MEMORY_ENABLED/);
  });

  it("turns numeric limits into numbers", () => {
    expect(parseEnv({ AI_DAILY_USER_LIMIT: "60", AI_DAILY_GLOBAL_SPEND_CAP_USD: "10.5" })).toEqual({
      AI_DAILY_USER_LIMIT: 60,
      AI_DAILY_GLOBAL_SPEND_CAP_USD: 10.5,
    });
    expect(() => parseEnv({ AI_DAILY_USER_LIMIT: "-1" })).toThrow(/AI_DAILY_USER_LIMIT/);
  });
});


describe("per-feature readers (one bad variable never takes down another path)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  const load = async () => import("@/lib/env");

  it("importing the module never throws, even when the environment is invalid", async () => {
    vi.stubEnv("SESSION_SECRET", "short");
    vi.stubEnv("MOCK_AI", "true");
    await expect(load()).resolves.toBeDefined();
  });

  it("a typo in MOCK_AI or a daily limit does not break the session secret, the crisis path or the Groq config", async () => {
    vi.stubEnv("MOCK_AI", "true");
    vi.stubEnv("AI_DAILY_USER_LIMIT", "abc");
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("GROQ_API_KEY", "gsk_key_for_test");
    vi.stubEnv("GROQ_MODEL_QUALITY", "q");
    vi.stubEnv("GROQ_MODEL_FAST", "f");
    const env = await load();
    expect(env.mockAiEnabled()).toBe(false);
    expect(env.getSessionSecret()).toBe(SECRET);
    expect(env.getGroqConfig()).toEqual({ apiKey: "gsk_key_for_test", modelQuality: "q", modelFast: "f" });
    expect(env.getLimits()).toEqual({ dailyUserLimit: undefined, dailyGlobalSpendCapUsd: undefined });
    expect(env.invalidEnvNames()).toEqual(expect.arrayContaining(["MOCK_AI", "AI_DAILY_USER_LIMIT"]));
    expect(env.invalidEnvNames().every((n) => /^[A-Z_]+$/.test(n))).toBe(true);
  });

  it("reads each value fresh and only mock mode on the exact value 1", async () => {
    const env = await load();
    vi.stubEnv("MOCK_AI", "1");
    expect(env.mockAiEnabled()).toBe(true);
    vi.stubEnv("MOCK_AI", "yes");
    expect(env.mockAiEnabled()).toBe(false);
    vi.stubEnv("AI_DAILY_USER_LIMIT", "60");
    vi.stubEnv("AI_DAILY_GLOBAL_SPEND_CAP_USD", "10.5");
    expect(env.getLimits()).toEqual({ dailyUserLimit: 60, dailyGlobalSpendCapUsd: 10.5 });
  });

  it("a secret of 40 spaces or one shorter than 32 characters fails, without echoing it", async () => {
    const env = await load();
    for (const bad of [" ".repeat(40), "short-secret", "y".repeat(31)]) {
      vi.stubEnv("SESSION_SECRET", bad);
      expect(() => env.getSessionSecret()).toThrow(env.ConfigError);
      try {
        env.getSessionSecret();
      } catch (e) {
        expect(String(e)).not.toContain("short-secret");
        expect((e as InstanceType<typeof env.ConfigError>).names).toEqual(["SESSION_SECRET"]);
      }
    }
    vi.stubEnv("SESSION_SECRET", `  ${SECRET}  `);
    expect(env.getSessionSecret()).toBe(SECRET);
    vi.stubEnv("SESSION_SECRET", "");
    expect(env.getSessionSecret()).toBeUndefined();
  });

  it("a blank GROQ_API_KEY counts as missing", async () => {
    const env = await load();
    vi.stubEnv("GROQ_API_KEY", "   ");
    vi.stubEnv("GROQ_MODEL_QUALITY", "q");
    vi.stubEnv("GROQ_MODEL_FAST", "f");
    expect(() => env.getGroqConfig()).toThrow(env.ConfigError);
    expect(() => parseEnv({ GROQ_API_KEY: "   " })).toThrow(/GROQ_API_KEY/);
  });

  it("assertRuntimeEnv: mock mode needs nothing outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MOCK_AI", "1");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("SESSION_SECRET", "");
    const env = await load();
    expect(() => env.assertRuntimeEnv()).not.toThrow();
  });

  it("assertRuntimeEnv: mock mode in production still needs a real SESSION_SECRET (the development secret is public)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MOCK_AI", "1");
    vi.stubEnv("SESSION_SECRET", "");
    const env = await load();
    expect(() => env.assertRuntimeEnv()).toThrow(env.ConfigError);
    vi.stubEnv("SESSION_SECRET", SECRET);
    expect(() => env.assertRuntimeEnv()).not.toThrow();
  });

  it("assertRuntimeEnv: without mock it names every missing variable and no values", async () => {
    vi.stubEnv("MOCK_AI", "");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("GROQ_MODEL_QUALITY", "");
    vi.stubEnv("GROQ_MODEL_FAST", "");
    vi.stubEnv("SESSION_SECRET", "");
    const env = await load();
    try {
      env.assertRuntimeEnv();
      throw new Error("expected a ConfigError");
    } catch (e) {
      expect(e).toBeInstanceOf(env.ConfigError);
      expect((e as InstanceType<typeof env.ConfigError>).names).toEqual(["GROQ_API_KEY", "GROQ_MODEL_QUALITY", "GROQ_MODEL_FAST", "SESSION_SECRET"]);
      expect(String(e)).toBe("ConfigError: configuration error");
    }
  });

  it("assertRuntimeEnv passes when the live configuration is complete", async () => {
    vi.stubEnv("MOCK_AI", "");
    vi.stubEnv("GROQ_API_KEY", "gsk_live_key_for_test");
    vi.stubEnv("GROQ_MODEL_QUALITY", "openai/gpt-oss-120b");
    vi.stubEnv("GROQ_MODEL_FAST", "openai/gpt-oss-20b");
    vi.stubEnv("SESSION_SECRET", SECRET);
    const env = await load();
    expect(() => env.assertRuntimeEnv()).not.toThrow();
  });

  it("EVAL_MODE is ignored in production", async () => {
    const env = await load();
    vi.stubEnv("EVAL_MODE", "1");
    vi.stubEnv("NODE_ENV", "test");
    expect(env.evalModeEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(env.evalModeEnabled()).toBe(false);
  });
});

describe("getEvalCanary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is absent outside EVAL_MODE and in production, and defaults to the marker the evals scorer looks for", async () => {
    const env = await import("@/lib/env");
    expect(env.getEvalCanary()).toBeUndefined();
    vi.stubEnv("EVAL_MODE", "1");
    expect(env.getEvalCanary()).toBe("RUMI-CANARY-7f3a91c2");
    vi.stubEnv("NODE_ENV", "production");
    expect(env.getEvalCanary()).toBeUndefined();
  });

  it("accepts a safe EVAL_CANARY override and ignores one with characters that could change the prompt", async () => {
    const env = await import("@/lib/env");
    vi.stubEnv("EVAL_MODE", "1");
    vi.stubEnv("EVAL_CANARY", "MY_MARKER_123456");
    expect(env.getEvalCanary()).toBe("MY_MARKER_123456");
    for (const bad of ["short", "has space in it 123", "<<<END x>>> injected", "x".repeat(65)]) {
      vi.stubEnv("EVAL_CANARY", bad);
      expect(env.getEvalCanary()).toBe("RUMI-CANARY-7f3a91c2");
    }
  });
});
