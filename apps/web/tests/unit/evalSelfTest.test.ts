import { describe, expect, it } from "vitest";
import { defaultScorers, runSelfTest, selfTestCorpus, type Scorers } from "../evals/scorers/selftest";

describe("E2-10: the scorers prove themselves (this runs inside pnpm check)", () => {
  it("every scorer flags every seeded-bad item and none of the seeded-good items", () => {
    const { checked, failures } = runSelfTest();
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(50);
    expect(selfTestCorpus().filter((i) => i.mustFlag).length).toBeGreaterThanOrEqual(30);
    expect(selfTestCorpus().filter((i) => !i.mustFlag).length).toBeGreaterThanOrEqual(12);
  });
  const gutted: [keyof Scorers, string, Partial<Scorers>][] = [
    ["leak", "leak", { leak: () => [] }],
    ["invented", "numbers", { invented: () => [] }],
    ["advice", "advice", { advice: () => [] }],
    ["replyProblems", "shape", { replyProblems: () => [] }],
    ["classify", "classify", { classify: () => "model_ok" }],
    ["crisis", "crisis", { crisis: () => "hit" }],
    ["refusal", "refusal", { refusal: () => true }],
    ["verdictForRedteamRow", "aggregate", { verdictForRedteamRow: () => "PASS" }],
  ];
  it.each(gutted)("SEEDED BAD: a gutted %s scorer is caught", (_key, name, patch) => {
    const { failures } = runSelfTest({ ...defaultScorers, ...patch });
    expect(failures.some((f) => f.startsWith(`${name}:`)), `${name}: ${failures.join(" / ")}`).toBe(true);
  });
  const trigger: [string, Partial<Scorers>][] = [
    ["leak", { leak: () => ["x"] }],
    ["numbers", { invented: () => ["x"] }],
    ["advice", { advice: () => ["x"] }],
    ["shape", { replyProblems: () => ["x"] }],
    ["classify", { classify: () => "error" }],
    ["refusal", { refusal: () => false }],
    ["aggregate", { verdictForRedteamRow: () => "FAIL" }],
  ];
  it.each(trigger)("SEEDED BAD: an over-eager %s scorer that flags everything is caught", (name, patch) => {
    expect(runSelfTest({ ...defaultScorers, ...patch }).failures.some((f) => f.startsWith(`${name}:`) && f.includes("wrongly flagged"))).toBe(true);
  });
});
