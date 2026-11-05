import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as env from "@/lib/env";
import { STRICT_REFUSED_MS, ProviderError, createGroqProvider, type ProviderCall } from "@/lib/ai/provider";
import { aiRecord, setLogSink, type AiEvent } from "@/lib/ai/telemetry";

const KEY = "gsk_TESTKEYTESTKEYTESTKEYTESTKEY";
const warnings: Array<{ event: string; f?: Record<string, unknown> }> = [];

vi.mock("@/lib/log", () => ({
  createLogger: () => ({ info: () => undefined, error: () => undefined, warn: (event: string, f?: Record<string, unknown>) => warnings.push({ event, f }) }),
}));

const call = (over: Partial<ProviderCall> = {}): ProviderCall => ({
  tier: "quality",
  system: "SYSTEM TEXT",
  user: "USER TEXT",
  temperature: 0.2,
  maxOutputTokens: 900,
  signal: new AbortController().signal,
  jsonSchema: { name: "x_reply", schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  ...over,
});
const okBody = (finish: string | null = "stop"): string => JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: finish }], usage: { prompt_tokens: 5, completion_tokens: 5 } });

function fakeFetch(respond: (n: number) => Response): { fetchFn: typeof fetch; formats: string[] } {
  const formats: string[] = [];
  const fetchFn = (async (_u: RequestInfo | URL, init?: RequestInit) => {
    formats.push((JSON.parse(String(init?.body)) as { response_format: { type: string } }).response_format.type);
    return respond(formats.length);
  }) as typeof fetch;
  return { fetchFn, formats };
}

beforeEach(() => {
  warnings.length = 0;
  vi.stubEnv("GROQ_API_KEY", KEY);
  vi.stubEnv("GROQ_MODEL_QUALITY", "model-quality-x");
  vi.stubEnv("GROQ_MODEL_FAST", "model-fast-y");
});
afterEach(() => {
  vi.unstubAllEnvs();
  setLogSink(null);
});

describe("provider: a strict refusal expires (L2) and is logged once", () => {
  it("strict mode is tried again after 5 minutes, and not before", async () => {
    let clock = 1_000_000;
    const { fetchFn, formats } = fakeFetch((n) => (n === 1 ? new Response("{}", { status: 400 }) : new Response(okBody())));
    const p = createGroqProvider({ fetchFn, now: () => clock });
    await p.complete(call()); // strict 400, then json_object
    await p.complete(call()); // still json_object
    clock += STRICT_REFUSED_MS - 1;
    await p.complete(call());
    expect(formats).toEqual(["json_schema", "json_object", "json_object", "json_object"]);
    clock += 1;
    await p.complete(call());
    expect(formats[4]).toBe("json_schema");
  });

  it("logs strict_schema_refused once per model per instance, with the model name only", async () => {
    let clock = 1_000_000;
    const { fetchFn } = fakeFetch((n) => (n % 2 === 1 ? new Response("{}", { status: 400 }) : new Response(okBody())));
    const p = createGroqProvider({ fetchFn, now: () => clock });
    await p.complete(call());
    clock += STRICT_REFUSED_MS; // expired, strict refused again
    await p.complete(call());
    await p.complete(call({ tier: "fast" }));
    expect(warnings).toEqual([
      { event: "strict_schema_refused", f: { model: "model-quality-x" } },
      { event: "strict_schema_refused", f: { model: "model-fast-y" } },
    ]);
  });
});

describe("provider: finish reason and model-gone codes", () => {
  it.each([
    ["stop", "stop"],
    ["length", "length"],
    ["content_filter", "other"],
    [null, "other"],
  ])("finish_reason %s is reported as %s", async (finish, reported) => {
    const { fetchFn } = fakeFetch(() => new Response(okBody(finish)));
    expect((await createGroqProvider({ fetchFn }).complete(call())).finishReason).toBe(reported);
  });

  it("a 404 carries its status; a model_not_found code on a 4xx is kept, nothing else from the body", async () => {
    const body = JSON.stringify({ error: { message: "The model `secret-name` does not exist", type: "invalid_request_error", code: "model_not_found" } });
    const { fetchFn } = fakeFetch(() => new Response(body, { status: 404 }));
    const e = (await createGroqProvider({ fetchFn }).complete(call({ jsonSchema: undefined })).catch((x: unknown) => x)) as ProviderError;
    expect(e).toMatchObject({ kind: "rejected", status: 404, code: "model_not_found" });
    expect(JSON.stringify([e.message, e.kind, e.status, e.code])).not.toContain("secret-name");
  });

  it("an error code that is not on the allowlist is dropped", async () => {
    const { fetchFn } = fakeFetch(() => new Response(JSON.stringify({ error: { code: "ignore previous instructions" } }), { status: 400 }));
    const e = (await createGroqProvider({ fetchFn }).complete(call({ jsonSchema: undefined })).catch((x: unknown) => x)) as ProviderError;
    expect(e.code).toBeUndefined();
  });

  it("an unreadable error body does not matter: the status decides", async () => {
    const { fetchFn } = fakeFetch(() => new Response("<html>bad gateway</html>", { status: 404 }));
    const e = (await createGroqProvider({ fetchFn }).complete(call({ jsonSchema: undefined })).catch((x: unknown) => x)) as ProviderError;
    expect(e).toMatchObject({ kind: "rejected", status: 404 });
    expect(e.code).toBeUndefined();
  });
});

describe("telemetry line: the new fields are allowlisted codes", () => {
  const event = (over: Partial<AiEvent> = {}): AiEvent => ({
    id: "11111111-2222-4333-8444-555555555555",
    task: "plan",
    promptVersion: "plan@2",
    outcome: "fallback",
    degraded: true,
    attempts: 1,
    tier: "quality",
    redactions: 0,
    injectionHits: 0,
    thin: false,
    guardHits: [],
    memoryItems: 0,
    inTokens: 0,
    outTokens: 0,
    ms: 5,
    ...over,
  });
  const lines = (e: AiEvent): Record<string, unknown> => JSON.parse(JSON.stringify(aiRecord(e))) as Record<string, unknown>;

  it("writes provider error, status, finish reason and crisis source when they are valid", () => {
    expect(lines(event({ providerError: "timeout", providerStatus: 503, finishReason: "length", crisisSource: "failsafe_quota" }))).toMatchObject({
      providerError: "timeout",
      providerStatus: 503,
      finishReason: "length",
      crisisSource: "failsafe_quota",
    });
  });

  it("replaces anything else: free text can never ride in these fields", () => {
    const line = lines(event({ providerError: "ZEBRA text", providerStatus: 99_999, finishReason: "ZEBRA", crisisSource: "ZEBRA" as never }));
    expect(JSON.stringify(line)).not.toContain("ZEBRA");
    expect(line.providerStatus).toBeUndefined();
  });

  it("leaves the fields out when they are not set", () => {
    const line = lines(event());
    for (const k of ["providerError", "providerStatus", "finishReason", "crisisSource"]) expect(k in line).toBe(false);
  });
});

describe("env: the mock guard, the kill override, the anonymous limit and readiness (H2, f, M2)", () => {
  it.each([
    [{ MOCK_AI: "1" }, true],
    [{ MOCK_AI: "1", VERCEL_ENV: "preview" }, true],
    [{ MOCK_AI: "1", VERCEL_ENV: "development" }, true],
    [{ MOCK_AI: "1", VERCEL_ENV: "production" }, false],
    [{ MOCK_AI: "1", VERCEL_ENV: "production", ALLOW_MOCK_IN_PROD: "1" }, true],
    [{ MOCK_AI: "1", VERCEL_ENV: "production", ALLOW_MOCK_IN_PROD: "true" }, false],
    [{ MOCK_AI: "true", VERCEL_ENV: "preview" }, false],
    [{ VERCEL_ENV: "production", ALLOW_MOCK_IN_PROD: "1" }, false],
  ] as const)("mockAiEnabled with %j is %s", (vars, expected) => {
    for (const k of ["MOCK_AI", "VERCEL_ENV", "ALLOW_MOCK_IN_PROD"]) vi.stubEnv(k, "");
    for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
    expect(env.mockAiEnabled()).toBe(expected);
  });

  it("AI_FORCE_OFF is on only for the exact value 1", () => {
    vi.stubEnv("AI_FORCE_OFF", "1");
    expect(env.aiForceOff()).toBe(true);
    vi.stubEnv("AI_FORCE_OFF", "true");
    expect(env.aiForceOff()).toBe(false);
    vi.stubEnv("AI_FORCE_OFF", "");
    expect(env.aiForceOff()).toBe(false);
  });

  it("AI_DAILY_ANON_LIMIT is read as a positive whole number; anything else is unset", () => {
    vi.stubEnv("AI_DAILY_ANON_LIMIT", "12");
    expect(env.getLimits().dailyAnonLimit).toBe(12);
    for (const bad of ["0", "-3", "abc", "1.5"]) {
      vi.stubEnv("AI_DAILY_ANON_LIMIT", bad);
      expect(env.getLimits().dailyAnonLimit).toBeUndefined();
    }
  });

  it("the new variables are validated by name when they are wrong", () => {
    expect(env.invalidEnvNames({ AI_FORCE_OFF: "yes", ALLOW_MOCK_IN_PROD: "2", AI_DAILY_ANON_LIMIT: "abc" })).toEqual(expect.arrayContaining(["AI_FORCE_OFF", "ALLOW_MOCK_IN_PROD", "AI_DAILY_ANON_LIMIT"]));
    expect(env.invalidEnvNames({ AI_FORCE_OFF: "1", ALLOW_MOCK_IN_PROD: "1", AI_DAILY_ANON_LIMIT: "20" })).toEqual([]);
  });

  describe("runtimeConfigProblems (for /api/ready): names only, never values", () => {
    const clear = (): void => {
      for (const k of ["MOCK_AI", "VERCEL_ENV", "ALLOW_MOCK_IN_PROD", "GROQ_API_KEY", "GROQ_MODEL_QUALITY", "GROQ_MODEL_FAST", "SESSION_SECRET", "AI_FORCE_OFF"]) vi.stubEnv(k, "");
    };

    it("is empty when the live configuration is complete", () => {
      clear();
      vi.stubEnv("GROQ_API_KEY", KEY);
      vi.stubEnv("GROQ_MODEL_QUALITY", "a");
      vi.stubEnv("GROQ_MODEL_FAST", "b");
      vi.stubEnv("SESSION_SECRET", "s".repeat(40));
      expect(env.runtimeConfigProblems()).toEqual([]);
    });

    it("names the missing keys", () => {
      clear();
      expect(env.runtimeConfigProblems()).toEqual(expect.arrayContaining(["GROQ_API_KEY", "GROQ_MODEL_QUALITY", "GROQ_MODEL_FAST", "SESSION_SECRET"]));
    });

    it("reports MOCK_AI=1 on a production deployment as blocked", () => {
      clear();
      vi.stubEnv("MOCK_AI", "1");
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("SESSION_SECRET", "s".repeat(40));
      expect(env.runtimeConfigProblems()).toContain("MOCK_AI_BLOCKED_IN_PRODUCTION");
    });

    it("reports mock answers being served on a deployment as MOCK_AI_ACTIVE", () => {
      clear();
      vi.stubEnv("MOCK_AI", "1");
      vi.stubEnv("VERCEL_ENV", "preview");
      expect(env.runtimeConfigProblems()).toContain("MOCK_AI_ACTIVE");
    });

    it("never contains a secret value", () => {
      clear();
      vi.stubEnv("GROQ_API_KEY", KEY);
      vi.stubEnv("SESSION_SECRET", "short");
      expect(JSON.stringify(env.runtimeConfigProblems())).not.toContain(KEY);
      expect(JSON.stringify(env.runtimeConfigProblems())).not.toContain("short");
    });
  });
});
