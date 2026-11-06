import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateCostMicroUsd, PRICES_PER_MTOK_USD } from "@/lib/ai/cost";
import { logEvent, setLogSink, type AiEvent } from "@/lib/ai/telemetry";
import { DEFAULT_PRICES } from "../evals/scorers/aggregate";
import { bodyOf, fakeProvider, fakeTask, post, say } from "./helpers/fakeTask";
import { runTask } from "@/lib/ai/harness";

describe("estimateCostMicroUsd", () => {
  it("prices a call from the per-million-token table (1 USD per million tokens = 1 micro-dollar per token)", () => {
    // 120b: 0.15 in, 0.60 out. 1000 in = 150, 500 out = 300.
    expect(estimateCostMicroUsd("openai/gpt-oss-120b", 1000, 500)).toBe(450);
    // 20b: 0.075 in, 0.30 out. 2000 in = 150, 1000 out = 300.
    expect(estimateCostMicroUsd("openai/gpt-oss-20b", 2000, 1000)).toBe(450);
  });
  it("rounds up so a real call is never free, and zero tokens cost zero", () => {
    expect(estimateCostMicroUsd("openai/gpt-oss-20b", 1, 0)).toBe(1);
    expect(estimateCostMicroUsd("openai/gpt-oss-20b", 0, 0)).toBe(0);
  });
  it("an unknown model, a negative or a non-finite count is 0 (never NaN, never negative)", () => {
    expect(estimateCostMicroUsd("some-other-model", 1000, 1000)).toBe(0);
    expect(estimateCostMicroUsd("openai/gpt-oss-120b", -5, Number.NaN)).toBe(0);
    expect(estimateCostMicroUsd("openai/gpt-oss-120b", Number.POSITIVE_INFINITY, 1)).toBe(1);
  });
  it("an own-property name like __proto__ or toString is not a model", () => {
    expect(estimateCostMicroUsd("__proto__", 100, 100)).toBe(0);
    expect(estimateCostMicroUsd("toString", 100, 100)).toBe(0);
  });
  it("matches the eval cost table, which cannot import src (D33), so the two never drift", () => {
    for (const [model, p] of Object.entries(PRICES_PER_MTOK_USD)) expect(DEFAULT_PRICES[model], model).toEqual({ inPerMTok: p.in, outPerMTok: p.out });
  });
});

describe("telemetry costMicroUsd", () => {
  const base: AiEvent = { id: "5f1d7c52-8f58-4d52-9a47-0f7a1b2c3d4e", task: "plan", promptVersion: "plan@3", outcome: "ok", degraded: false, attempts: 1, tier: "fast", redactions: 0, injectionHits: 0, thin: false, guardHits: [], memoryItems: 0, inTokens: 1, outTokens: 1, costMicroUsd: 0, ms: 1 };
  afterEach(() => setLogSink(null));
  const line = (e: unknown): Record<string, unknown> => {
    const lines: string[] = [];
    setLogSink((l) => lines.push(l));
    logEvent(e as AiEvent);
    return JSON.parse(lines[0]) as Record<string, unknown>;
  };
  it("is a whole non-negative number; anything else (text, NaN, negative) becomes 0", () => {
    expect(line({ ...base, costMicroUsd: 450 }).costMicroUsd).toBe(450);
    expect(line({ ...base, costMicroUsd: 12.9 }).costMicroUsd).toBe(12);
    for (const bad of ["a user sentence", Number.NaN, -3, null, {}]) expect(line({ ...base, costMicroUsd: bad }).costMicroUsd).toBe(0);
    expect(line(base).costMicroUsd).toBe(0);
  });
});

describe("harness adds up the cost of every provider call", () => {
  const lines: string[] = [];
  beforeEach(() => {
    lines.length = 0;
    setLogSink((l) => lines.push(l));
  });
  afterEach(() => setLogSink(null));
  it("two calls (one retry) are both priced, with the model each one reported", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([
      () => ({ text: say("CODE:advice_dose"), modelUsed: "openai/gpt-oss-120b", inTokens: 1000, outTokens: 500 }),
      () => ({ text: say("fine"), modelUsed: "openai/gpt-oss-20b", inTokens: 2000, outTokens: 1000 }),
    ]);
    const res = await runTask(spec, post({ text: "Headaches.", companionName: "Rumi" }), { provider });
    expect(((await bodyOf(res)) as { say: string }).say).toBe("fine");
    const ev = JSON.parse(lines[0]) as { costMicroUsd: number; inTokens: number };
    expect(ev.inTokens).toBe(3000);
    expect(ev.costMicroUsd).toBe(450 + 450);
  });
});
