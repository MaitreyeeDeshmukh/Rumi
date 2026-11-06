import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCrisisCheckPrompt } from "@/lib/ai/prompt";
import { CRISIS_SYSTEM, main, parseJsonObject, percentile, requestBody, sampleFrom, summarise } from "../../scripts/groq-spike.mjs";

afterEach(() => vi.unstubAllGlobals());

describe("spike helpers", () => {
  it("percentile is nearest-rank and null for no values", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 90)).toBe(5);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 50)).toBe(50);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90)).toBe(90);
    expect(percentile([3, 1, 2], 100)).toBe(3);
  });
  it("parseJsonObject takes one object, optionally fenced, and nothing else", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    for (const bad of ["", "text", "[1]", "null", "{oops", undefined]) expect(parseJsonObject(bad)).toBeUndefined();
  });
  it("sampleFrom flags empty, length-cut and reasoning-only answers and reads the token counts", () => {
    const body = (content: unknown, finish = "stop") => ({ choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 7, completion_tokens_details: { reasoning_tokens: 5 } } });
    expect(sampleFrom(200, 100, body('{"a":1}'))).toMatchObject({ empty: false, parsed: true, inTok: 10, outTok: 7, reasoningTok: 5, finish: "stop" });
    expect(sampleFrom(200, 100, body("", "length"))).toMatchObject({ empty: true, parsed: false, finish: "length" });
    expect(sampleFrom(200, 100, body(null))).toMatchObject({ empty: true });
    expect(sampleFrom(500, 9, undefined)).toMatchObject({ status: 500, empty: true });
  });
  it("summarise counts statuses, takes latency only from the 200s, sums tokens, counts empties and parses", () => {
    const s = (status: number, ms: number, empty = false, parsed = true) => ({ status, ms, inTok: 10, outTok: 4, reasoningTok: 2, empty, parsed, finish: "stop" });
    const r = summarise([s(200, 100), s(200, 300), s(200, 200, true, false), s(429, 5000), s(500, 1)]);
    expect(r).toMatchObject({ calls: 5, status: { 200: 3, 429: 1, 500: 1 }, p50Ms: 200, p90Ms: 300, inTokens: 30, outTokens: 12, reasoningTokens: 6, empty: 1, parsed: 2 });
    expect(summarise([])).toMatchObject({ calls: 0, p50Ms: null, p90Ms: null, empty: 0 });
  });
  it("requestBody sends reasoning effort only to gpt-oss models", () => {
    const base = { system: "s", user: "u", maxTokens: 400 };
    expect(requestBody({ model: "openai/gpt-oss-20b", ...base })).toMatchObject({ reasoning_effort: "low", response_format: { type: "json_object" }, max_completion_tokens: 400 });
    expect(requestBody({ model: "llama-3.3-70b", ...base })).not.toHaveProperty("reasoning_effort");
  });
  it("the crisis prompt it sends is the one the harness sends", () => {
    expect(CRISIS_SYSTEM).toBe(buildCrisisCheckPrompt("abcdefgh12", "x").system);
  });
});

describe("main", () => {
  it("without a key prints one line, calls nothing and exits 0", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const lines: string[] = [];
    expect(await main({} as NodeJS.ProcessEnv, (l: string) => lines.push(l))).toBe(0);
    expect(lines).toEqual(["groq spike skipped: GROQ_API_KEY not set"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("with a scripted Groq runs all three experiments, prints only numbers, and ends with SPIKE RESULT", async () => {
    const seen: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      seen.push(body);
      const strict = (body.response_format as { type: string }).type === "json_schema";
      const cap = body.max_completion_tokens as number;
      const content = cap === 400 && !strict && body.model === "m-quality" ? "" : '{"crisis":false}';
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: content === "" ? "length" : "stop" }], usage: { prompt_tokens: 50, completion_tokens: 9 } }), { status: 200 });
    });
    const lines: string[] = [];
    const code = await main({ GROQ_API_KEY: "gsk_SPIKEKEYSPIKEKEY", GROQ_MODEL_QUALITY: "m-quality", GROQ_MODEL_FAST: "m-fast" } as unknown as NodeJS.ProcessEnv, (l: string) => lines.push(l));
    expect(code).toBe(0);
    expect(seen).toHaveLength(2 * 6 + 2 + 4);
    expect(lines.at(-1)).toMatch(/^SPIKE RESULT \{/);
    const result = JSON.parse(lines.at(-1)!.slice("SPIKE RESULT ".length)) as { a: Record<string, { calls: number }>; b: Record<string, { accepted: boolean; obeyed: boolean }>; c: Record<string, Record<string, { empty: boolean; finish: string }>> };
    expect(result.a.fast.calls).toBe(6);
    expect(result.b.quality).toMatchObject({ accepted: true, obeyed: true });
    expect(result.c.quality["400"]).toMatchObject({ empty: true, finish: "length" });
    expect(result.c.quality["1200"].empty).toBe(false);
    const all = lines.join("\n");
    expect(all).not.toMatch(/gsk_|SECRET|Classify|headache|TASK/);
  });
});
