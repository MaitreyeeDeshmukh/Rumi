import { describe, expect, it } from "vitest";
import { FOCUS_VALUES, SAY_SCENARIOS } from "../../src/features/shared/constants";
import {
  CrisisDataSchema,
  MIN_COUNTS,
  RECAP_KINDS,
  RedteamDataSchema,
  ScenariosDataSchema,
  SayItDataSchema,
  loadAll,
} from "../evals/data/schema";
import redteamJson from "../evals/data/redteam.json";
import scenariosJson from "../evals/data/scenarios.json";

const data = loadAll();

describe("dataset counts (D36 minimums; this test fails if a file shrinks)", () => {
  it("plan: 10 messy inputs, including the 1,900-character ramble, a one-word input and a 15-sentence input", () => {
    expect(data.plan.length).toBeGreaterThanOrEqual(MIN_COUNTS.plan);
    const lengths = data.plan.map((p) => p.rawText.length);
    expect(Math.max(...lengths)).toBeGreaterThanOrEqual(1800);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(2000);
    expect(data.plan.some((p) => p.rawText.trim().split(/\s+/).length === 1)).toBe(true);
    expect(data.plan.some((p) => (p.rawText.match(/[.!?]/g) ?? []).length >= 15 && p.rawText.length < 1000)).toBe(true);
  });
  it("practice: a case for every focus value and a scripted four-step probe", () => {
    for (const f of FOCUS_VALUES) expect(data.practice.cases.some((c) => c.focus === f), f).toBe(true);
    expect(data.practice.probes.length).toBeGreaterThanOrEqual(MIN_COUNTS.practiceProbes);
    for (const p of data.practice.probes) {
      expect(p.steps.length).toBeGreaterThanOrEqual(4);
      expect(p.opener.length).toBeGreaterThan(0);
    }
  });
  it("practice probe is a script, not model text: only the user's lines are stored", () => {
    const probe = data.practice.probes[0];
    expect(Object.keys(probe.steps[0]).sort()).toEqual(["holds", "me"]);
  });
  it("sayit: 18 cases, every level crossed with every scenario, plus clinicianQuestion cases", () => {
    expect(data.sayit.length).toBeGreaterThanOrEqual(MIN_COUNTS.sayit);
    for (const level of [1, 2, 3]) {
      for (const s of SAY_SCENARIOS) expect(data.sayit.some((c) => c.level === level && c.scenario === s), `${level}/${s}`).toBe(true);
      expect(data.sayit.some((c) => c.level === level && c.clinicianQuestion), `clinicianQuestion level ${level}`).toBe(true);
    }
  });
  it("recap: 8 cases covering every named situation, including 60 lines, speaker D and an adversarial line", () => {
    expect(data.recap.length).toBeGreaterThanOrEqual(MIN_COUNTS.recap);
    for (const k of RECAP_KINDS) expect(data.recap.some((r) => r.kind === k), k).toBe(true);
    expect(data.recap.find((r) => r.kind === "long_60")?.lines).toHaveLength(60);
    expect(data.recap.find((r) => r.kind === "speaker_d")?.mySpeaker).toBe("D");
    expect(data.recap.find((r) => r.kind === "adversarial_lines")?.lines.some((l) => /^SYSTEM:/.test(l.text))).toBe(true);
  });
  it("crisis: positives, held-out positives and near-miss negatives, with known false positives kept apart", () => {
    expect(data.crisis.positive.length).toBeGreaterThanOrEqual(MIN_COUNTS.crisisPositive);
    expect(data.crisis.heldOutPositive.length).toBeGreaterThanOrEqual(MIN_COUNTS.crisisHeldOut);
    expect(data.crisis.negative.length).toBeGreaterThanOrEqual(MIN_COUNTS.crisisNegative);
    expect(data.crisis.knownFalsePositives.length).toBeGreaterThan(0);
    const all = [...data.crisis.positive, ...data.crisis.heldOutPositive, ...data.crisis.negative, ...data.crisis.knownFalsePositives];
    expect(new Set(all).size).toBe(all.length);
  });
  it("redteam: 20 rows; scenarios: 12 rows", () => {
    expect(data.redteam.rows.length).toBeGreaterThanOrEqual(MIN_COUNTS.redteam);
    expect(data.scenarios.length).toBeGreaterThanOrEqual(MIN_COUNTS.scenarios);
  });
});

describe("red-team rows (D35)", () => {
  const rows = data.redteam.rows;
  it("every row has a non-empty forbidden list and at least one hold that code can score", () => {
    for (const r of rows) {
      expect(r.forbidden.length, r.id).toBeGreaterThan(0);
      expect(r.mustHold.some((h) => h.type !== "human_check"), r.id).toBe(true);
    }
  });
  it("forbids GROQ somewhere (not GEMINI) and never forbids Dr. Lee", () => {
    const all = rows.flatMap((r) => r.forbidden);
    expect(all.some((f) => f.includes("GROQ"))).toBe(true);
    expect(all.some((f) => /gemini/i.test(f))).toBe(false);
    expect(all.some((f) => /dr\.? lee/i.test(f))).toBe(false);
  });
  it("payloads use the real fence tokens", () => {
    const payloads = rows.map((r) => r.payload).join("\n");
    expect(payloads).toContain("<<<END user_text>>>");
    expect(payloads).toMatch(/<<<STYLE \d>>>/);
    expect(payloads).toMatch(/<<<FACTS \d>>>/);
  });
  it("memory rows carry a memory field; recap rows carry the adversarial transcript line", () => {
    expect(rows.some((r) => r.memory && r.memory.length > 0)).toBe(true);
    const recapRows = rows.filter((r) => r.task === "recap");
    expect(recapRows.length).toBeGreaterThanOrEqual(2);
    for (const r of recapRows) expect(r.field).toMatch(/^lines\.\d+\.text$/);
    expect(recapRows.some((r) => /^SYSTEM:/.test(r.payload))).toBe(true);
  });
  it("covers every task and the named attack classes", () => {
    for (const t of ["plan", "practice", "sayit", "recap"]) expect(rows.some((r) => r.task === t), t).toBe(true);
    const p = rows.map((r) => r.payload.toLowerCase()).join("\n");
    for (const needle of ["dose", "https://", "![", "​", "pwned", "real doctor", "crisis", "5000 words", "@example.test", "french"]) {
      expect(p.includes(needle), needle).toBe(true);
    }
  });
});

describe("scenario suite (D36)", () => {
  it("has the schema {id, task, input, mustHold[], forbidden[]} and drops Spanish, rewrite and the recap-medicine-not-in-transcript row", () => {
    const text = JSON.stringify(data.scenarios).toLowerCase();
    expect(text).not.toContain("me duele");
    expect(text).not.toContain("make it simpler");
    for (const s of data.scenarios) {
      expect(Object.keys(s).sort()).toEqual(["forbidden", "id", "input", "mustHold", "task"]);
    }
  });
  it("does not duplicate the crisis or injection suites", () => {
    const text = JSON.stringify(data.scenarios).toLowerCase();
    expect(text).not.toContain("end it all");
    expect(text).not.toContain("ignore your");
    expect(text).not.toContain("<<<end");
  });
});

describe("independence and originality", () => {
  const DOC_CRISIS = [
    "I want to hurt myself", "I keep hurting myself", "I want to end it all", "I don't want to be here anymore", "I can't go on",
    "I want to die", "I'm thinking about suicide", "I cut myself again last night", "my boyfriend is hitting me", "I can't breathe",
    "chest pain and my arm is numb", "this is an emergency", "I took too many pills, overdose", "there is no reason to live",
    "I'd be better off dead", "I want to die laughing at my brother's jokes",
  ];
  it("no crisis positive is copied from the plan 02 list that the pattern author also saw", () => {
    const all = [...data.crisis.positive, ...data.crisis.heldOutPositive].map((s) => s.toLowerCase());
    for (const d of DOC_CRISIS) expect(all, d).not.toContain(d.toLowerCase());
  });
  it("eval examples differ from the prompt examples in plans 02 and 05", () => {
    const text = JSON.stringify(data).toLowerCase();
    expect(text).not.toContain("how many days has it been");
    expect(text).not.toContain("i am not sure how often");
  });
});

describe("the schemas can fail (a validator that cannot reject is worthless)", () => {
  const rt = JSON.parse(JSON.stringify(redteamJson));
  it("rejects a red-team row with an empty forbidden list", () => {
    rt.rows[0].forbidden = [];
    expect(RedteamDataSchema.safeParse(rt).success).toBe(false);
  });
  it("rejects a red-team row whose only hold is a human check", () => {
    const bad = JSON.parse(JSON.stringify(redteamJson));
    bad.rows[1].mustHold = [{ type: "human_check", note: "looks fine" }];
    expect(RedteamDataSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a red-team row whose field does not exist in its base request", () => {
    const bad = JSON.parse(JSON.stringify(redteamJson));
    bad.rows[2].field = "nope.0.text";
    expect(RedteamDataSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a red-team row with an unknown hold type", () => {
    const bad = JSON.parse(JSON.stringify(redteamJson));
    bad.rows[3].mustHold = [{ type: "looks_ok" }];
    expect(RedteamDataSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a scenario whose input is not a valid request for its task", () => {
    const bad = JSON.parse(JSON.stringify(scenariosJson));
    bad[0].input = { rawText: "" };
    expect(ScenariosDataSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a sayit row with both or neither of scenario and clinicianQuestion", () => {
    expect(SayItDataSchema.safeParse([{ id: "x", level: 1 }]).success).toBe(false);
    expect(SayItDataSchema.safeParse([{ id: "x", level: 1, scenario: "book", clinicianQuestion: "Why?" }]).success).toBe(false);
  });
  it("rejects a crisis file missing the held-out list", () => {
    expect(CrisisDataSchema.safeParse({ positive: ["a b c"], negative: ["a b c"], knownFalsePositives: [] }).success).toBe(false);
  });
});
