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
    expect(() => parseEnv({ MEMORY_TAG_SECRET: "y".repeat(31) })).toThrow(/MEMORY_TAG_SECRET/);
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

describe("getEnv and assertRuntimeEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("importing the module never throws, even when the environment is invalid", async () => {
    vi.stubEnv("SESSION_SECRET", "short");
    await expect(import("@/lib/env")).resolves.toBeDefined();
  });

  it("getEnv reads process.env lazily and memoises a valid result", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_first");
    const { getEnv } = await import("@/lib/env");
    expect(getEnv().GROQ_API_KEY).toBe("gsk_first");
    vi.stubEnv("GROQ_API_KEY", "gsk_second");
    expect(getEnv().GROQ_API_KEY).toBe("gsk_first");
  });

  it("getEnv throws on bad configuration without caching the failure", async () => {
    vi.stubEnv("SESSION_SECRET", "short");
    const { getEnv } = await import("@/lib/env");
    expect(() => getEnv()).toThrow(/SESSION_SECRET/);
    vi.stubEnv("SESSION_SECRET", SECRET);
    expect(getEnv().SESSION_SECRET).toBe(SECRET);
  });

  it("with MOCK_AI=1 nothing else is required", async () => {
    vi.stubEnv("MOCK_AI", "1");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("SESSION_SECRET", "");
    const { assertRuntimeEnv } = await import("@/lib/env");
    expect(() => assertRuntimeEnv()).not.toThrow();
  });

  it("without MOCK_AI it names every missing variable and no values", async () => {
    vi.stubEnv("MOCK_AI", "");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("GROQ_MODEL_QUALITY", "");
    vi.stubEnv("GROQ_MODEL_FAST", "");
    vi.stubEnv("SESSION_SECRET", "");
    const { assertRuntimeEnv } = await import("@/lib/env");
    expect(() => assertRuntimeEnv()).toThrow(/GROQ_API_KEY.*GROQ_MODEL_QUALITY.*GROQ_MODEL_FAST.*SESSION_SECRET/);
  });

  it("passes when the live configuration is complete", async () => {
    vi.stubEnv("MOCK_AI", "");
    vi.stubEnv("GROQ_API_KEY", "gsk_live_key_for_test");
    vi.stubEnv("GROQ_MODEL_QUALITY", "openai/gpt-oss-120b");
    vi.stubEnv("GROQ_MODEL_FAST", "openai/gpt-oss-20b");
    vi.stubEnv("SESSION_SECRET", SECRET);
    const { assertRuntimeEnv } = await import("@/lib/env");
    expect(() => assertRuntimeEnv()).not.toThrow();
  });
});
