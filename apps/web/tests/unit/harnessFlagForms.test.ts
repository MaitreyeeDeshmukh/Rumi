import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTask, type HarnessDeps } from "@/lib/ai/harness";
import { createGroqProvider } from "@/lib/ai/provider";
import { setLogSink } from "@/lib/ai/telemetry";
import { createRateLimiter } from "@/lib/security/rateLimit";
import { bodyOf, fakeProvider, fakeTask, okBody, post, say } from "./helpers/fakeTask";

const deps = (provider: HarnessDeps["provider"]): HarnessDeps => ({ provider, limiter: createRateLimiter(), rand: () => "0123456789ab" });
const ZW = "​";

beforeEach(() => setLogSink(() => undefined));
afterEach(() => {
  setLogSink(null);
  vi.unstubAllEnvs();
});

describe("the model's own crisis flag (D5), P3 forms", () => {
  it.each([
    ["curly quotes", "{“crisis”:true}"],
    ["curly single quotes", "{‘crisis’: true}"],
    ["fullwidth letters in the key", '{"ｃｒｉｓｉｓ":true}'],
    ["a fullwidth colon and quotes", "＂crisis＂： true"],
    ["a zero-width space before true", `{"crisis":${ZW}true}`],
    ["zero-width characters inside the key", `{"cri${ZW}sis":true}`],
    ["a zero-width joiner and a word joiner", `{"crisis":‍⁠true}`],
    ["the number 1", '{"crisis":1}'],
    ["the string yes", '{"crisis":"yes"}'],
    ["Yes with a capital in a fence", '```json\n{"say":"x","crisis":"Yes"}\n```'],
    ["a soft hyphen", `{"cris­is":true}`],
  ])("%s still returns the card", async (_n, text) => {
    const res = await runTask(fakeTask().spec, post(okBody()), deps(fakeProvider([text, say("not asked")])));
    expect(await bodyOf(res)).toEqual({ crisis: true });
  });

  it.each([
    ["false", '{"say":"ok","crisis":false}'],
    ["0", '{"say":"ok","crisis":0}'],
    ["no", '{"say":"ok","crisis":"no"}'],
    ["a number that starts with 1", '{"say":"ok","crisis":10}'],
    ["the word in a sentence", say("a crisis line is open all day, yes it is")],
    ["a word that only starts with true", '{"say":"ok","crisis":"trueish"}'],
  ])("does not trigger on %s", async (_n, text) => {
    const res = await runTask(fakeTask().spec, post(okBody()), deps(fakeProvider([text, text])));
    expect(await bodyOf(res)).not.toEqual({ crisis: true });
  });
});

describe("reasoning_effort follows the model id, whatever its case", () => {
  it("sends low reasoning effort to GPT-OSS written in any case, and nothing to other models", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test_key_for_unit_tests_only");
    vi.stubEnv("GROQ_MODEL_QUALITY", "OpenAI/GPT-OSS-120B");
    vi.stubEnv("GROQ_MODEL_FAST", "llama-3.1-8b-instant");
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
    }) as typeof fetch;
    const p = createGroqProvider({ fetchFn });
    const call = { system: "s", user: "u", temperature: 0, maxOutputTokens: 10, signal: new AbortController().signal };
    await p.complete({ ...call, tier: "quality" });
    await p.complete({ ...call, tier: "fast" });
    expect(bodies[0].reasoning_effort).toBe("low");
    expect("reasoning_effort" in bodies[1]).toBe(false);
  });
});
