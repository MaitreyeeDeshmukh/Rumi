/**
 * The roaster's 46 proofs from the Phase 1 code review, kept as regression tests. Each test states the CORRECT behaviour.
 * Finding ids match the report (F-1 ...). fixRound.test.ts widens them in both directions.
 */
import { describe, expect, it } from "vitest";
import { practiceFallback } from "@/features/practice/fallback";
import { verifyEvidence } from "@/features/recap/verifyEvidence";
import { level1Codes } from "@/features/sayit/level1";
import { PracticeRequest } from "@/features/shared/schemas";
import type { RecapItem, TranscriptLine } from "@/features/shared/types";
import { DEMO_PLAN } from "@/fixtures/demoPlan";
import { literalLint } from "@/lib/literalLint";
import { blankCodes, ledgerFromTexts, ungroundedSpecifics } from "@/lib/text/specifics";
import { practiceTask } from "../../prompts/practice";
import { STOP_LINE, WAIT_LINE } from "../../prompts/persona";
import { confirmCovered } from "@/features/practice/confirmCovered";

const E = ledgerFromTexts([]);
const line = (text: string, speaker: TranscriptLine["speaker"] = "A"): TranscriptLine[] => [{ id: "l1", speaker, text }];
const item = (section: RecapItem["section"], text: string): RecapItem => ({ section, text, evidence: ["l1"] });
const accepted = (lines: TranscriptLine[], it: RecapItem): boolean => verifyEvidence(lines, { items: [it], planStatus: [] }, "B").items.length > 0;
const pf = (turns: { role: "me" | "clinician"; text: string }[]) =>
  practiceFallback(PracticeRequest.parse({ plan: DEMO_PLAN, turns, focus: "whole", companionName: "Rumi" }));
const me = (text: string) => [{ role: "clinician" as const, text: "Hi." }, { role: "me" as const, text }];

describe("F-1 stop request ignored by the practice fallback", () => {
  for (const t of ["I have headaches. Please stop.", "I'm tired", "Can we stop?", "I'm not sure, stop", "I need a break, stop please"]) {
    it(`honours: ${t}`, () => {
      const r = pf(me(t));
      expect(r.clinicianSay).toBe(STOP_LINE);
      expect(r.isLastTurn).toBe(true);
    });
  }
});

describe("F-2 recap accepts items with unsupported clauses (40% overlap)", () => {
  it("added advice sentence", () => {
    expect(accepted(line("Please keep a headache diary for two weeks. Write down when it starts."), item("instructions", "Keep a headache diary. Avoid caffeine."))).toBe(false);
  });
  it("added urgency", () => {
    expect(accepted(line("Please come back in four weeks."), item("next_steps", "Come back in four weeks. It is urgent."))).toBe(false);
  });
  it("added diagnosis (lowercase)", () => {
    expect(accepted(line("Your head hurts after class. Does anything help?"), item("discussed", "Your head hurts after class because of migraine."))).toBe(false);
  });
  it("unlisted medicine swapped in, lowercase, outside the medications section", () => {
    expect(accepted(line("Please take ibuprofen daily."), item("instructions", "take panadol daily"))).toBe(false);
  });
});

describe("F-3 recap accepts a flipped instruction when no medicine name is involved", () => {
  const flips: [string, string][] = [
    ["Do not skip the diary.", "Skip the diary."],
    ["Never lift heavy boxes.", "Lift heavy boxes."],
    ["You cannot drive for a week.", "You can drive for a week."],
    ["Please stop the medicine.", "Please start the medicine."],
  ];
  for (const [src, out] of flips) it(`${src} -> ${out}`, () => expect(accepted(line(src), item("instructions", out))).toBe(false));
});

describe("F-4 dose unit swap with a spelled-out unit", () => {
  it("400 mg -> 400 grams", () => expect(accepted(line("Take ibuprofen 400 mg daily."), item("medications", "Ibuprofen: 400 grams daily."))).toBe(false));
  it("100 mcg -> 100 milligrams", () => expect(accepted(line("Take levothyroxine 100 mcg daily."), item("medications", "Levothyroxine: 100 milligrams daily."))).toBe(false));
  it("200 mg -> 200 micrograms (specifics alone)", () => expect(ungroundedSpecifics("Take 200 micrograms.", ledgerFromTexts(["Take 200 mg."])).ok).toBe(false));
});

describe("F-5 dose attached to the wrong medicine inside one cited line", () => {
  it("warfarin dose given to ibuprofen", () =>
    expect(accepted(line("Take warfarin 5 mg and ibuprofen 200 mg."), item("medications", "Ibuprofen: 5 mg."))).toBe(false));
});

describe("F-6 negation words missing for medicines", () => {
  for (const [src, out] of [["Please skip ibuprofen for now.", "Ibuprofen: take for now."], ["Hold off on ibuprofen for now.", "Ibuprofen: take for now."], ["Discontinue ibuprofen today.", "Ibuprofen: take today."], ["Stay away from ibuprofen for now.", "Ibuprofen: use for now."]])
    it(src, () => expect(accepted(line(src), item("medications", out))).toBe(false));
});

describe("F-7 number written as word or ordinal word", () => {
  it("twenty-one is not 20", () => expect(accepted(line("Take 20 pills."), item("instructions", "Take twenty-one pills."))).toBe(false));
  it("fourth week is not second week", () => expect(accepted(line("Come back in the fourth week."), item("next_steps", "Come back in the second week."))).toBe(false));
  it("one week is a duration like a week", () => expect(ungroundedSpecifics("I have had this for one week.", E).ok).toBe(false));
});

describe("F-8 an instruction can cite only the user's own words", () => {
  it("user line becomes a clinician instruction", () => {
    expect(accepted(line("I take ibuprofen sometimes.", "B"), item("instructions", "Take ibuprofen sometimes."))).toBe(false);
  });
});

describe("F-9 false positives on ordinary punctuation (backlog P2, still open)", () => {
  const cases: [string, string[]][] = [
    ["I want to ask: Why do I get these?", ["headaches"]],
    ["I want to tell you: My head hurts.", ["head hurts"]],
    ["Hello, Doctor. I am not sure.", []],
    ["Okay, Thank you. I am not sure.", []],
  ];
  for (const [t, l] of cases) it(t, () => expect(ungroundedSpecifics(t, ledgerFromTexts(l)).ok).toBe(true));
  it("WAIT_LINE (prompt-mandated) passes grounding with an empty ledger", () => expect(ungroundedSpecifics(WAIT_LINE, E).ok).toBe(true));
  it("'I am Dr. Lee' passes grounding (persona name)", () => expect(ungroundedSpecifics("Hi. I am Dr. Lee.", E).ok).toBe(true));
});

describe("F-10 level 1 starter can carry an ungrounded claim about the user", () => {
  it("claim about the body inside the starter", () => {
    expect(level1Codes("Which part? You can start with: I have a bad headache and it hurts a lot ...")).toContain("level1_statement");
  });
});

describe("F-11 blank grammar stricter than the prompt says", () => {
  for (const b of ["[what's happening]", "[what, if anything, helps]", "[what is happening?]"])
    it(b, () => expect(blankCodes(`I want to say ${b}`)).toEqual([]));
});

describe("F-12 invented relationship / name words", () => {
  for (const t of ["My kid hits me.", "My neighbour shouts at me.", "My ex follows me.", "Patel told me to rest."]) it(t, () => expect(ungroundedSpecifics(t, E).ok).toBe(false));
  it("confusable drug name (Cyrillic e)", () => expect(ungroundedSpecifics("I take ibuprofеn.", E).ok).toBe(false));
  it("unlisted brand drug, lowercase", () => expect(ungroundedSpecifics("I take panadol.", E).ok).toBe(false));
});

describe("F-13 lint false positives on literal use", () => {
  for (const q of ["What kind of pain is it?", "What sort of food do you eat?"]) it(q, () => expect(literalLint(q).ok).toBe(true));
});

describe("F-14 practice prompt contradiction for focus=questions", () => {
  it("the opening line must not be the closing trigger", () => {
    const p = practiceTask("questions");
    const opens = /Start with "Hi\. Do you have any questions for me\?"/.test(p);
    const closesAfter = /isLastTurn: true after you asked "Do you have any questions for me\?"/.test(p);
    expect(opens && closesAfter).toBe(false);
  });
  it("turn cap in the prompt equals the code cap (7)", () => {
    expect(practiceTask("whole")).not.toMatch(/after 8 clinician turns/);
  });
});

describe("F-15 covered credit from one stray word", () => {
  it("'I am writing a note' does not cover 'instructions in writing'", () => {
    expect(confirmCovered(["q4"], DEMO_PLAN, ["I am writing a note"])).toEqual([]);
  });
});
