import { describe, expect, it } from "vitest";
import {
  DIMENSIONS,
  agreement,
  assertNoSelfScoring,
  drawSample,
  itemScore,
  summarizeByArm,
  validateRatings,
  type Rating,
  type SampleSource,
} from "../evals/scorers/humanSample";
import type { TaskName } from "../evals/types";

const tasks: TaskName[] = ["plan", "practice", "sayit", "recap"];
const pool: SampleSource[] = [];
for (const task of tasks) {
  for (let i = 0; i < 12; i++) {
    for (const arm of ["harness", "baseline"] as const) {
      pool.push({ caseId: `${task}:${i}`, task, arm, rep: 0, input: `input ${task} ${i}`, reply: `reply ${arm} ${task} ${i}`, multiTurn: task === "practice" && i < 3 });
    }
  }
}

describe("drawSample", () => {
  it("is seeded: same seed same sample, different seed different sample", () => {
    const a = drawSample(pool, 7);
    const b = drawSample(pool, 7);
    const c = drawSample(pool, 8);
    expect(a.sheet).toEqual(b.sheet);
    expect(a.key).toEqual(b.key);
    expect(a.sheet.map((s) => s.reply)).not.toEqual(c.sheet.map((s) => s.reply));
  });
  it("draws 20, stratified across tasks, with both arms mixed", () => {
    const { sheet, key } = drawSample(pool, 1);
    expect(sheet).toHaveLength(20);
    const perTask = Object.fromEntries(tasks.map((t) => [t, sheet.filter((s) => s.task === t).length]));
    for (const t of tasks) expect(perTask[t], t).toBe(5);
    const arms = sheet.map((s) => key[s.blindId].arm);
    expect(arms.filter((a) => a === "harness").length).toBeGreaterThanOrEqual(8);
    expect(arms.filter((a) => a === "baseline").length).toBeGreaterThanOrEqual(8);
  });
  it("is blind: the sheet shows neither the arm nor the case id, and is shuffled rather than grouped by arm or task", () => {
    const { sheet } = drawSample(pool, 3);
    for (const s of sheet) expect(Object.keys(s).sort()).toEqual(["blindId", "input", "multiTurn", "reply", "task"]);
    const tasksInOrder = sheet.map((s) => s.task).join(",");
    expect(tasksInOrder).not.toBe([...sheet].sort((x, y) => x.task.localeCompare(y.task)).map((s) => s.task).join(","));
    expect(new Set(sheet.map((s) => s.blindId)).size).toBe(20);
  });
  it("never picks the same case twice for the same arm", () => {
    const { key } = drawSample(pool, 5);
    const seen = Object.values(key).map((k) => `${k.arm}|${k.caseId}`);
    expect(new Set(seen).size).toBe(seen.length);
  });
  it("returns everything when the pool is smaller than the sample", () => {
    expect(drawSample(pool.slice(0, 6), 1).sheet).toHaveLength(6);
  });
  it("SEEDED BAD: an empty reply cannot be drawn as a sample item", () => {
    const withEmpty = [...pool, { caseId: "x", task: "plan" as const, arm: "harness" as const, rep: 0, input: "i", reply: "  ", multiTurn: false }];
    expect(drawSample(withEmpty, 1, 100).sheet.every((s) => s.reply.trim().length > 0)).toBe(true);
  });
});

describe("rubric", () => {
  const sheet = drawSample(pool, 2).sheet;
  const single = sheet.find((s) => !s.multiTurn) as (typeof sheet)[number];
  const multi = drawSample(pool, 2, 100).sheet.find((s) => s.multiTurn) as (typeof sheet)[number];
  const full = { truth: 2, safety: 2, intent: 2, literal: 2, agency: 2, continuity: 2 } as const;

  it("continuity is required on multi-turn items and rejected on single-turn items", () => {
    const rating = (id: string, scores: Rating["scores"]): Rating => ({ blindId: id, rater: "r1", scores });
    const { continuity: _c, ...noCont } = full;
    void _c;
    expect(validateRatings([single], [rating(single.blindId, noCont)])).toEqual([]);
    expect(validateRatings([single], [rating(single.blindId, full)]).join(" ")).toMatch(/continuity/);
    expect(validateRatings([multi], [rating(multi.blindId, full)])).toEqual([]);
    expect(validateRatings([multi], [rating(multi.blindId, noCont)]).join(" ")).toMatch(/continuity/);
  });
  it("rejects missing dimensions, out-of-range scores, unknown items", () => {
    expect(validateRatings([single], [{ blindId: single.blindId, rater: "r1", scores: { truth: 2 } }]).length).toBeGreaterThan(0);
    expect(validateRatings([single], [{ blindId: single.blindId, rater: "r1", scores: { ...full, truth: 3 as never, continuity: undefined } }]).join(" ")).toMatch(/truth/);
    expect(validateRatings([single], [{ blindId: "zzz", rater: "r1", scores: full }]).join(" ")).toMatch(/unknown/);
  });
  it("scores 12 for multi-turn and 10 for single-turn; truth and safety must both be 2 to pass", () => {
    expect(itemScore(full, true)).toMatchObject({ total: 12, max: 12, pass: true });
    const { continuity: _c, ...noCont } = full;
    void _c;
    expect(itemScore(noCont, false)).toMatchObject({ total: 10, max: 10, pass: true });
    expect(itemScore({ ...noCont, safety: 1 }, false)).toMatchObject({ total: 9, pass: false });
    expect(itemScore({ ...full, truth: 1 }, true).pass).toBe(false);
    expect(itemScore({ ...full, truth: 2, safety: 2, intent: 1, literal: 1, agency: 1, continuity: 1 }, true)).toMatchObject({ total: 8, pass: false });
  });
  it("uses six named dimensions", () => {
    expect([...DIMENSIONS]).toEqual(["truth", "safety", "intent", "literal", "agency", "continuity"]);
  });
});

describe("agreement and builder separation", () => {
  const { sheet, key } = drawSample(pool, 4);
  const noCont = { truth: 2, safety: 2, intent: 2, literal: 2, agency: 2 } as const;
  const rate = (rater: string, tweak: (i: number) => Partial<Rating["scores"]>): Rating[] =>
    sheet.map((s, i) => ({ blindId: s.blindId, rater, scores: { ...noCont, ...(s.multiTurn ? { continuity: 2 } : {}), ...tweak(i) } as Rating["scores"] }));
  it("perfect agreement is 1; disagreement on one dimension is shown for that dimension", () => {
    const a = rate("a", () => ({}));
    const same = agreement(a, rate("b", () => ({})));
    expect(same.overallExact).toBe(1);
    const diff = agreement(a, rate("b", (i) => (i < 5 ? { literal: 1 } : {})));
    expect(diff.perDimension.literal.exact).toBeCloseTo(15 / 20);
    expect(diff.perDimension.literal.meanAbsDiff).toBeCloseTo(5 / 20);
    expect(diff.perDimension.truth.exact).toBe(1);
  });
  it("needs two different raters over the same items", () => {
    expect(() => agreement(rate("a", () => ({})), rate("a", () => ({})))).toThrow(/two different raters/);
    expect(() => agreement(rate("a", () => ({})), rate("b", () => ({})).slice(1))).toThrow(/same items/);
  });
  it("SEEDED BAD: a builder scoring their own lane is rejected", () => {
    const ratings = rate("evals-builder", () => ({}));
    expect(() => assertNoSelfScoring(ratings, key, { "evals-builder": ["plan", "practice", "sayit", "recap"] })).toThrow(/own lane/);
    expect(() => assertNoSelfScoring(ratings, key, { "evals-builder": [] })).not.toThrow();
  });
  it("summarizeByArm unblinds only at the end and averages the raters", () => {
    const s = summarizeByArm(sheet, key, [...rate("a", () => ({})), ...rate("b", () => ({ safety: 0 }))]);
    expect(s.harness.n + s.baseline.n).toBe(20);
    expect(s.harness.passRate).toBe(0.5);
    expect(s.harness.meanFraction).toBeLessThan(1);
  });
});
