import { describe, expect, it } from "vitest";
import {
  ARMS,
  PINNED,
  assertHarnessParity,
  baselineCall,
} from "../evals/baseline";
import { buildCases } from "../evals/cases";
import { loadAll } from "../evals/data/schema";
import { scoreCase } from "../evals/scorers/score";
import { DEFAULT_CANARY } from "../evals/scorers/leak";
import type { TaskName } from "../evals/types";

const TASKS: TaskName[] = ["plan", "practice", "sayit", "recap"];
const PINNED_KEYS = ["tier", "temperature", "maxOutputTokens", "reasoningEffort", "taskSentence"] as const;
const LOGGED_FIELDS = ["arm", "modelUsed", "attempts"] as const;

describe("baseline arm pin (D34)", () => {
  it("every pinned parameter is present for every task", () => {
    for (const t of TASKS) {
      const p = PINNED[t];
      for (const key of PINNED_KEYS) expect(p[key], `${t}.${key}`).toBeDefined();
      expect(["quality", "fast"]).toContain(p.tier);
      expect(p.temperature).toBeGreaterThanOrEqual(0);
      expect(p.temperature).toBeLessThanOrEqual(1);
      expect(Number.isInteger(p.maxOutputTokens) && p.maxOutputTokens > 0).toBe(true);
      expect(["low", "medium", "high"]).toContain(p.reasoningEffort);
      expect(p.taskSentence.split(/[.!?]/).filter((s) => s.trim()).length, `${t} task text is one sentence`).toBe(1);
    }
  });
  it("tiers follow 06: plan and recap on the quality model, practice and sayit on the fast one", () => {
    expect(PINNED.plan.tier).toBe("quality");
    expect(PINNED.recap.tier).toBe("quality");
    expect(PINNED.practice.tier).toBe("fast");
    expect(PINNED.sayit.tier).toBe("fast");
  });
  it("arms: baseline gets one attempt, harness up to three, and the log fields are fixed", () => {
    expect(ARMS.baseline.maxCalls).toBe(1);
    expect(ARMS.harness.maxCalls).toBe(3);
  });
  it("baselineCall carries every pinned parameter, the same JSON schema keys as the model output, and the one-sentence task", () => {
    const call = baselineCall("sayit", { level: 1, scenario: "book", companionName: "Jo" });
    expect(call).toMatchObject({ tier: "fast", temperature: PINNED.sayit.temperature, maxOutputTokens: PINNED.sayit.maxOutputTokens, reasoningEffort: PINNED.sayit.reasoningEffort, maxCalls: 1 });
    expect(call.system).toBe(PINNED.sayit.taskSentence);
    expect(Object.keys((call.jsonSchema as { properties: object }).properties).sort()).toEqual(["blanks", "crisis", "script"]);
    expect(call.user).toContain('"scenario":"book"');
  });
  it("baselineCall has no harness machinery: no persona, no rules, no fence tokens", () => {
    const call = baselineCall("plan", { rawText: "my knee hurts", companionName: "Jo" });
    expect(call.system).not.toMatch(/<<<|never|must not|rules/i);
  });
});

describe("assertHarnessParity (Phase 2/3 calls this with the real TaskSpecs)", () => {
  const same = Object.fromEntries(TASKS.map((t) => [t, { tier: PINNED[t].tier, temperature: PINNED[t].temperature, maxOutputTokens: PINNED[t].maxOutputTokens }])) as never;
  it("passes when the harness specs match the pin", () => {
    expect(() => assertHarnessParity(same)).not.toThrow();
  });
  it("SEEDED BAD: a different temperature, token cap or tier is rejected with the task named", () => {
    const hot = structuredClone(same) as Record<TaskName, { tier: string; temperature: number; maxOutputTokens: number }>;
    hot.practice.temperature = PINNED.practice.temperature + 0.3;
    expect(() => assertHarnessParity(hot as never)).toThrow(/practice.*temperature/);
    const cap = structuredClone(same) as typeof hot;
    cap.recap.maxOutputTokens = 10;
    expect(() => assertHarnessParity(cap as never)).toThrow(/recap.*maxOutputTokens/);
    const tier = structuredClone(same) as typeof hot;
    tier.plan.tier = "fast";
    expect(() => assertHarnessParity(tier as never)).toThrow(/plan.*tier/);
  });
});

describe("arm, modelUsed and attempts survive into every result for both arms", () => {
  it.each(["harness", "baseline"] as const)("%s", (arm) => {
    const c = buildCases(loadAll(), arm).find((x) => x.id === "plan:p06");
    if (!c) throw new Error("no case");
    const r = scoreCase(c, [{ status: 200, degraded: false, attempts: 2, modelUsed: "openai/gpt-oss-120b", mode: "live", body: { plan: { id: "p", title: "t", createdAt: "x", mainConcern: "Ear pain on the left.", symptomsInMyWords: [], items: [{ id: "q1", text: "Ear pain on the left.", kind: "concern", source: "user", enabled: true }] } } }], { arm, rep: 1, canary: DEFAULT_CANARY });
    for (const f of LOGGED_FIELDS) expect(r[f], f).not.toBeUndefined();
    expect(r).toMatchObject({ arm, modelUsed: "openai/gpt-oss-120b", attempts: 2 });
  });
});
