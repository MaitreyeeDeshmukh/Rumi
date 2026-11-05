import { describe, expect, it } from "vitest";
import { classify, isRateLimited, SAFETY_CLASSES } from "../evals/scorers/classify";
import type { Observation } from "../evals/types";

const ok = (over: Partial<Observation> = {}): Observation => ({
  status: 200,
  degraded: false,
  attempts: 1,
  modelUsed: "openai/gpt-oss-20b",
  mode: "live",
  body: { clinicianSay: "What would you like to start with?", coveredItemIds: [], isLastTurn: false },
  ...over,
});

describe("classify", () => {
  it("one clean attempt is model_ok, two or three is retry_ok", () => {
    expect(classify(ok())).toBe("model_ok");
    expect(classify(ok({ attempts: 2 }))).toBe("retry_ok");
    expect(classify(ok({ attempts: 3 }))).toBe("retry_ok");
  });

  it("degraded replies are fallback even when a model was called", () => {
    expect(classify(ok({ degraded: true, attempts: 3 }))).toBe("fallback");
    expect(classify(ok({ degraded: true, attempts: 0, modelUsed: null }))).toBe("fallback");
  });

  it("crisis body is crisis, wherever it came from", () => {
    expect(classify(ok({ body: { crisis: true }, attempts: 0, modelUsed: null }))).toBe("crisis");
    expect(classify(ok({ body: { crisis: "true" } }))).not.toBe("crisis");
  });

  it("MOCK_AI answers are mock and never model_ok, even if the body looks fine", () => {
    expect(classify(ok({ mode: "mock" }))).toBe("mock");
    expect(classify(ok({ modelUsed: "mock" }))).toBe("mock");
  });

  it("an empty reply is empty, not a success (seeded bad: blank string, empty object, whitespace-only text)", () => {
    expect(classify(ok({ body: "" }))).toBe("empty");
    expect(classify(ok({ body: null }))).toBe("empty");
    expect(classify(ok({ body: {} }))).toBe("empty");
    expect(classify(ok({ body: { clinicianSay: "   ", coveredItemIds: [] } }))).toBe("empty");
    expect(classify(ok({ body: { items: [], unconfirmed: [] } }))).toBe("empty");
    expect(SAFETY_CLASSES).not.toContain("empty");
  });

  it("http errors and error bodies are error; 429 is detected as rate limited", () => {
    expect(classify(ok({ status: 500, body: { error: { code: "ai_unavailable" } } }))).toBe("error");
    expect(classify(ok({ status: 200, body: { error: { code: "ai_invalid", message: "x" } } }))).toBe("error");
    const rl = ok({ status: 429, body: { error: { code: "rate_limited", message: "slow down" } } });
    expect(classify(rl)).toBe("error");
    expect(isRateLimited(rl)).toBe(true);
    expect(isRateLimited(ok({ status: 200, body: { error: { code: "rate_limited" } } }))).toBe(true);
    expect(isRateLimited(ok())).toBe(false);
  });

  it("a non-crisis, non-degraded reply with no model call is error, because nothing was measured", () => {
    expect(classify(ok({ attempts: 0, modelUsed: null }))).toBe("error");
    expect(classify(ok({ modelUsed: null }))).toBe("error");
  });

  it("only model_ok and retry_ok feed the safety metrics", () => {
    expect([...SAFETY_CLASSES]).toEqual(["model_ok", "retry_ok"]);
  });
});
