import { describe, expect, it } from "vitest";
import { DRY_LABEL, renderReport } from "../evals/scorers/report";
import { aggregate } from "../evals/scorers/aggregate";
import type { CaseClass, CaseResult } from "../evals/types";

const mk = (over: Partial<CaseResult> = {}): CaseResult => {
  const cls: CaseClass = over.cls ?? "model_ok";
  return {
    caseId: `c${Math.random()}`, suite: "plan", task: "plan", arm: "harness", rep: 0, cls, modelUsed: "openai/gpt-oss-20b", attempts: 1,
    flags: [], holdFailures: [], onTask: true, requests: 1, perRequest: [{ cls, latencyMs: 300, tier: "fast" }], calls: [], lintClean: true, ...over,
  };
};
const good = aggregate(Array.from({ length: 30 }, () => mk()));
const bad = aggregate([...Array.from({ length: 29 }, () => mk()), mk({ flags: ["leak_canary"], suite: "redteam" })]);
const invalid = aggregate([...Array.from({ length: 29 }, () => mk()), mk({ cls: "mock" })]);

describe("renderReport", () => {
  it("DRY: every single line says DRY RUN, NOT MEASUREMENT, including the verdict and blank-looking separators", () => {
    const lines = renderReport([{ arm: "harness", summary: bad }], { mode: "dry", k: 3, commit: "abc1234" });
    expect(lines.length).toBeGreaterThan(10);
    for (const l of lines) expect(l, l).toContain(DRY_LABEL);
    expect(lines.some((l) => l.trim() === "")).toBe(false);
    expect(DRY_LABEL).toBe("DRY RUN, NOT MEASUREMENT");
  });
  it("DRY never prints a bare PASS: the verdict is the label plus what it would have been", () => {
    const lines = renderReport([{ arm: "harness", summary: good }], { mode: "dry", k: 3 });
    const verdict = lines.find((l) => l.startsWith("VERDICT"));
    expect(verdict).toContain("DRY RUN, NOT MEASUREMENT");
    expect(lines.join("\n")).not.toMatch(/VERDICT: PASS/);
  });
  it("LIVE lines carry no dry label", () => {
    const lines = renderReport([{ arm: "harness", summary: good }], { mode: "live", k: 3, commit: "abc1234" });
    for (const l of lines) expect(l).not.toContain("DRY RUN");
    expect(lines.find((l) => l.startsWith("VERDICT"))).toBe("VERDICT: PASS");
  });
  it("shows k/n beside each safety metric and lists the class counts", () => {
    const text = renderReport([{ arm: "harness", summary: bad }], { mode: "live", k: 3 }).join("\n");
    expect(text).toMatch(/leak_canary\s+29\/30/);
    expect(text).toMatch(/model_ok=30/);
    expect(text).toMatch(/lower/);
    expect(text).toContain("adviceLeak");
    expect(text).toContain("inventedSpecifics");
    expect(text).toContain("injectionResisted");
    expect(text).toContain("crisisRecall");
  });
  it("a failing run prints FAIL and the failed gate names; an INVALID run prints the reasons and never PASS or FAIL", () => {
    const failText = renderReport([{ arm: "harness", summary: bad }], { mode: "live", k: 3 }).join("\n");
    expect(failText).toContain("VERDICT: FAIL");
    expect(failText).toContain("leak_canary");
    const inv = renderReport([{ arm: "harness", summary: invalid }], { mode: "live", k: 3 }).join("\n");
    expect(inv).toContain("VERDICT: INVALID");
    expect(inv).toMatch(/class mock/);
    expect(inv).not.toContain("VERDICT: PASS");
  });
  it("prints the arm table side by side when both arms are present, and says crisis is not applicable to the baseline", () => {
    const text = renderReport([{ arm: "harness", summary: good }, { arm: "baseline", summary: bad }], { mode: "live", k: 3 }).join("\n");
    expect(text).toMatch(/arm table/i);
    expect(text).toMatch(/harness/);
    expect(text).toMatch(/baseline/);
    expect(text).toMatch(/not applicable/i);
  });
  it("cost is shown as n/a when it cannot be computed, and as unverified when prices are not dated", () => {
    const text = renderReport([{ arm: "harness", summary: good }], { mode: "live", k: 3 }).join("\n");
    expect(text).toMatch(/cost per session: n\/a/);
    const priced = aggregate([
      mk({ suite: "plan", calls: [{ model: "openai/gpt-oss-120b", tokensIn: 1000, tokensOut: 500 }] }),
      mk({ suite: "practice", task: "practice", calls: [{ model: "openai/gpt-oss-20b", tokensIn: 1000, tokensOut: 500 }] }),
      mk({ suite: "sayit", task: "sayit", calls: [{ model: "openai/gpt-oss-20b", tokensIn: 1000, tokensOut: 500 }] }),
      mk({ suite: "recap", task: "recap", calls: [{ model: "openai/gpt-oss-120b", tokensIn: 1000, tokensOut: 500 }] }),
    ]);
    expect(renderReport([{ arm: "harness", summary: priced }], { mode: "live", k: 3 }).join("\n")).toMatch(/prices unverified/);
  });
});
