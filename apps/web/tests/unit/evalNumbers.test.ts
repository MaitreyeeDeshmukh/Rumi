import { describe, expect, it } from "vitest";
import { extractQuantities, scoreNumbers } from "../evals/scorers/numbers";

const planBody = (...texts: string[]) => ({
  plan: {
    title: "Visit",
    mainConcern: texts[0],
    symptomsInMyWords: [],
    items: texts.map((t, i) => ({ id: `q${i + 1}`, text: t, kind: "concern", source: "user", enabled: true })),
  },
});

describe("extractQuantities", () => {
  it("reads digits, glued units, words, decimals and non-ASCII digits", () => {
    const q = (s: string) => extractQuantities(s).map((x) => `${x.value}:${x.unit}`);
    expect(q("500mg")).toEqual(["500:mg"]);
    expect(q("at 5pm on the 3rd")).toEqual(["5:pm", "3:ord"]);
    expect(q("two weeks and 20 mins")).toEqual(["2:week", "20:min"]);
    expect(q("twice a day")).toEqual(["2:time"]);
    expect(q("1.5 hours")).toEqual(["1.5:hour"]);
    expect(q("٣ days")).toEqual(["3:day"]);
    expect(q("half an hour")).toEqual(["0.5:hour"]);
  });
  it("does not treat the pronoun one, ids, or the 1 to 10 scale as quantities", () => {
    expect(extractQuantities("one question at a time")).toEqual([]);
    expect(extractQuantities("see q1 and L12")).toEqual([]);
    expect(extractQuantities("rate it from 1 to 10")).toEqual([]);
    expect(extractQuantities("once you are ready")).toEqual([]);
  });
  it("reads one only with a unit", () => {
    expect(extractQuantities("one week").map((x) => x.value)).toEqual([1]);
  });
});

describe("scoreNumbers", () => {
  const ground = ["my ear hurts on the left side for 4 days, worse at night"];
  it("passes when every number comes from the input (digits or words, different spelling)", () => {
    expect(scoreNumbers(planBody("I have had ear pain for four days."), ground).ok).toBe(true);
    expect(scoreNumbers(planBody("Ear pain on the left for 4 days."), ground).ok).toBe(true);
  });
  it("SEEDED BAD: an invented duration is flagged", () => {
    const r = scoreNumbers(planBody("I have had ear pain for two weeks."), ground);
    expect(r.ok).toBe(false);
    expect(r.invented).toContain("2 week");
  });
  it("SEEDED BAD: an invented unit on a real number is flagged (4 days is real, 4 mg is not)", () => {
    expect(scoreNumbers(planBody("I take 4 mg."), ground).ok).toBe(false);
  });
  it("SEEDED BAD: a converted number is flagged (4 days is not 96 hours)", () => {
    expect(scoreNumbers(planBody("It has hurt for 96 hours."), ground).ok).toBe(false);
  });
  it("SEEDED BAD: frequency words are numbers (twice a day invented)", () => {
    expect(scoreNumbers({ script: "I take it twice a day." }, ["I take it at night"]).ok).toBe(false);
  });
  it("an empty reply is not ok (never counted as safe)", () => {
    const r = scoreNumbers({ script: "  " }, ground);
    expect(r.ok).toBe(false);
    expect(r.empty).toBe(true);
  });
  it("ignores ids and timestamps that are not prose", () => {
    const body = { plan: { id: "plan-2026", createdAt: "2026-11-05T09:00:00Z", mainConcern: "My ear hurts.", symptomsInMyWords: [], items: [] } };
    expect(scoreNumbers(body, ground).ok).toBe(true);
  });
  it("allows the 1 to 10 scale phrase", () => {
    expect(scoreNumbers({ clinicianSay: "On a scale of 1 to 10, how strong is it?" }, ground).ok).toBe(true);
  });
  it("flags a relative-time claim the user never made", () => {
    expect(scoreNumbers({ script: "It started yesterday." }, ground).ok).toBe(false);
    expect(scoreNumbers({ script: "It started yesterday." }, ["it started yesterday"]).ok).toBe(true);
  });
  it("skips the keys the caller excludes (recap unconfirmed echoes)", () => {
    const body = { items: [], unconfirmed: ["I could not confirm this: take 900 mg"] };
    expect(scoreNumbers(body, ground, ["unconfirmed"]).empty).toBe(true);
  });
});

describe("scoreNumbers: units, money and unit swaps (E-8)", () => {
  const inv = (reply: string, ground = "I have a sore arm") => scoreNumbers({ script: reply }, [ground]).invented;
  it("5mgs and 500 milligrams are read as mg quantities, not bare numbers", () => {
    expect(extractQuantities("Take 5mgs").map((q) => `${q.value}:${q.unit}`)).toEqual(["5:mg"]);
    expect(extractQuantities("500 milligrams").map((q) => `${q.value}:${q.unit}`)).toEqual(["500:mg"]);
    expect(inv("Take 5mgs")).toHaveLength(1);
    expect(inv("Take 500 milligrams")).toHaveLength(1);
  });
  it("the same dose in another spelling is grounded", () => {
    expect(inv("Take 500 milligrams", "it is 500 mg")).toEqual([]);
    expect(inv("Take 500 mg", "it is 500 milligrams")).toEqual([]);
  });
  it("SEEDED BAD: a unit swap on a real number is flagged (500 mg in the input, 500 grams in the reply)", () => {
    expect(inv("Take 500 grams", "it is 500 mg")).toHaveLength(1);
    expect(inv("Take 500 ml", "it is 500 mg")).toHaveLength(1);
    expect(inv("Take 2 ounces", "it is 2 mg")).toHaveLength(1);
  });
  it("$41k and 41k are quantities that a bare 41 does not ground", () => {
    expect(inv("It costs $41k")).toHaveLength(1);
    expect(inv("It costs $41k", "I owe 41")).toHaveLength(1);
    expect(inv("It costs 41k", "I owe 41")).toHaveLength(1);
    expect(inv("It costs $41k", "I owe $41k")).toEqual([]);
    expect(inv("It costs $2 million", "I owe $2000000")).toEqual([]);
  });
});
