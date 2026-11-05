import { describe, expect, it } from "vitest";
import { classify, isMalformedBaseline, isRateLimited, SAFETY_CLASSES } from "../evals/scorers/classify";
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

describe("classify: every status x degraded x attempts x modelUsed x mode combination (E-3)", () => {
  const statuses = [0, 199, 200, 201, 204, 304, 400, 429, 500];
  const models: (string | null)[] = [null, "", "m", "openai/gpt-oss-20b", "mock", "fallback", "none", "FALLBACK", "n/a", "bad model"];
  const realModel = (m: string | null) => m !== null && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(m) && !["mock", "fallback", "none", "n/a"].includes(m.toLowerCase());

  it("model_ok / retry_ok only for status exactly 200, not degraded (wrapper or body), 1-3 attempts, a real model name, not mock", () => {
    let checked = 0;
    for (const status of statuses)
      for (const degraded of [false, true])
        for (const bodyDegraded of [false, true])
          for (const attempts of [-1, 0, 1, 2, 3, 4, 1.5, Number.NaN])
            for (const modelUsed of models)
              for (const mode of ["live", "dry", "mock"] as const) {
                const body = { script: "Hello there", blanks: [], ...(bodyDegraded ? { degraded: true } : {}) };
                const got = classify({ status, degraded, attempts, modelUsed, mode, body });
                const shouldBeOk = status === 200 && !degraded && !bodyDegraded && Number.isInteger(attempts) && attempts >= 1 && attempts <= 3 && realModel(modelUsed) && mode !== "mock";
                expect(got === "model_ok" || got === "retry_ok", `${status}/${degraded}/${bodyDegraded}/${attempts}/${modelUsed}/${mode} -> ${got}`).toBe(shouldBeOk);
                if (shouldBeOk) expect(got).toBe(attempts === 1 ? "model_ok" : "retry_ok");
                checked++;
              }
    expect(checked).toBeGreaterThan(5000);
  });
  it("the wire flag body.degraded alone makes a reply fallback", () => {
    expect(classify(ok({ body: { script: "Hello there", blanks: [], degraded: true } }))).toBe("fallback");
  });
  it("the exact success status is 200: 199, 201, 204, 304 are errors", () => {
    for (const status of [199, 201, 204, 304]) expect(classify(ok({ status })), String(status)).toBe("error");
    expect(classify(ok({ status: 200 }))).toBe("model_ok");
  });
  it("baseline arm: one attempt only; more means harness machinery leaked in", () => {
    expect(classify(ok({ attempts: 2 }), { arm: "baseline" })).toBe("error");
    expect(classify(ok({ attempts: 1 }), { arm: "baseline" })).toBe("model_ok");
  });
  it("baseline arm: malformed or empty output is a counted model_ok (on-task failure), harness arm: empty (E-13)", () => {
    for (const body of ["", null, {}, "I think so", { script: "  " }]) {
      expect(classify(ok({ body }), { arm: "baseline" }), JSON.stringify(body)).toBe("model_ok");
      expect(isMalformedBaseline(ok({ body }), "baseline")).toBe(true);
      expect(classify(ok({ body }), { arm: "harness" })).toBe("empty");
    }
  });
  it("baseline arm: transport errors and mock stay INVALID classes", () => {
    expect(classify(ok({ status: 500, body: "" }), { arm: "baseline" })).toBe("error");
    expect(classify(ok({ mode: "mock", body: "" }), { arm: "baseline" })).toBe("mock");
    expect(classify(ok({ body: { error: { code: "x" } } }), { arm: "baseline" })).toBe("error");
    expect(classify(ok({ modelUsed: null, body: "" }), { arm: "baseline" })).toBe("error");
  });
});
