/**
 * 07 D14: every hard rule must be satisfiable. Each escape-hatch output below must produce zero HARD codes when the
 * ledger is EMPTY (the user said nothing usable). Rules owned by the harness lane (advice, clinician_finding,
 * claims_human) are not importable in Phase 1; P2 extends this file with them. The hatches here are the real
 * fallback outputs, so a rule that would reject them fails this test.
 */
import { describe, expect, it } from "vitest";
import { planFallback } from "@/features/plan/fallback";
import { mainConcernCodes, planItemCodes } from "@/features/plan/keepSupportedSymptoms";
import { SCRIPT } from "@/features/practice/fallback";
import { unknownLabelCodes } from "@/features/practice/labels";
import { recapFallback } from "@/features/recap/fallback";
import { recapEmptyCodes, verifyEvidence } from "@/features/recap/verifyEvidence";
import { level1Codes } from "@/features/sayit/level1";
import { isHard, type GuardCode } from "@/features/shared/guards";
import { DEMO_PLAN } from "@/fixtures/demoPlan";
import { blankCodes, ledgerFromTexts, specificsCodes } from "@/lib/text/specifics";
import { lintCodes } from "@/lib/literalLint";
import { ADVICE_REFUSAL, CLOSING_LINE, NOTES_LINE, STOP_LINE, WAIT_LINE } from "../../prompts/persona";

const EMPTY = ledgerFromTexts([]);
const hard = (codes: GuardCode[]): GuardCode[] => codes.filter(isHard);

/** The rules every free-text output goes through, with the empty ledger. */
const textRules = (text: string): GuardCode[] => [...specificsCodes(text, EMPTY), ...blankCodes(text)];

describe("plan hatch: the user's first sentence, word for word", () => {
  for (const raw of ["I keep getting headaches", "dizzy", "my knee hurts when I climb stairs. also loud rooms", "stomach hurts after lunch maybe??"]) {
    it(`passes every hard rule: ${raw.slice(0, 30)}`, () => {
      const reply = planFallback({ rawText: raw, companionName: "Rumi" });
      const items = reply.plan.items;
      expect(hard([...mainConcernCodes(raw, reply.plan.mainConcern), ...planItemCodes(items), ...items.flatMap((i) => textRules(i.text))])).toEqual([]);
      expect(hard(textRules(reply.plan.mainConcern))).toEqual([]);
    });
  }

  it("a sentence with real specifics is still grounded when the ledger is the user's own text", () => {
    const raw = "Dr Patel said take 500mg at 5pm";
    const items = planFallback({ rawText: raw, companionName: "Rumi" }).plan.items;
    expect(specificsCodes(items.map((i) => i.text), ledgerFromTexts([raw]))).toEqual([]);
  });

  it("text with no content word falls back to the fixed prompt, which has no user item to check", () => {
    const reply = planFallback({ rawText: "ok", companionName: "Rumi" });
    expect(hard(reply.plan.items.flatMap((i) => textRules(i.text)))).toEqual([]);
    expect(mainConcernCodes("ok", reply.plan.mainConcern)).toEqual([]);
  });
});

describe("practice hatch: a question and nothing else", () => {
  it("'Do you have any questions for me?' has no specific, no unknown label and no digit", () => {
    const line = "Do you have any questions for me?";
    expect(hard([...textRules(line), ...unknownLabelCodes(DEMO_PLAN, [])])).toEqual([]);
    expect(line).not.toMatch(/\d/);
    expect(SCRIPT.whole).toContain(line);
  });

  it("every fixed line the practice fallback can say states no finding, no number and no blank", () => {
    // Practice has no grounding rule (the clinician asks, it does not state facts); its hard rule is clinician_finding,
    // which belongs to the harness lane. This stand-in uses the patterns of 07 D15 until P2 imports the real guard.
    const finding = /looks (normal|fine|good)|nothing to worry|your (blood pressure|weight|temperature|test|results)|(results|test|scan) (is|are|show)/i;
    const lines = [...new Set([...Object.values(SCRIPT).flat(), ADVICE_REFUSAL, WAIT_LINE, STOP_LINE, CLOSING_LINE, NOTES_LINE, "Hi. I am Dr. Lee."])];
    for (const line of lines) {
      expect(blankCodes(line), line).toEqual([]);
      // F-9b: the lines the prompts make the model say also pass grounding with an empty ledger ("Help me say it", "Dr. Lee").
      expect(specificsCodes(line, EMPTY), line).toEqual([]);
      expect(line, line).not.toMatch(/\d/);
      expect(line, line).not.toMatch(finding);
    }
  });
});

describe("say it hatches (D14)", () => {
  const L1 = "What detail do you want to add? You can start with: I am not sure ...";
  const L2 = "I want to tell you about [what is happening].";
  const L3 = "I am not sure how to say this. Can you ask me one question at a time?";

  it("level 1 is a question with no statement about the user", () => {
    expect(hard([...textRules(L1), ...level1Codes(L1)])).toEqual([]);
  });

  it("level 2 has one valid blank and no other specific", () => {
    expect(hard(textRules(L2))).toEqual([]);
    expect(blankCodes(L2)).toEqual([]);
  });

  it("level 3 needs no fact at all, and no blank", () => {
    expect(hard(textRules(L3))).toEqual([]);
    expect(L3).not.toContain("[");
  });

  it("all three are plain enough to pass lint too", () => {
    expect(lintCodes([L1, L2, L3])).toEqual([]);
  });
});

describe("recap hatch: no items, and a fixed line saying so", () => {
  it("lines with nothing usable give a reply that is not 'empty' and has no unknown reference", () => {
    const lines = [{ id: "a", speaker: "A" as const, text: "Okay." }];
    const reply = recapFallback({ lines, mySpeaker: "B", plan: DEMO_PLAN });
    expect(reply.items).toEqual([]);
    expect(hard(recapEmptyCodes(reply))).toEqual([]);
    const ids = new Set(DEMO_PLAN.items.map((i) => i.id));
    for (const p of reply.planStatus) expect(ids.has(p.itemId)).toBe(true);
  });

  it("a model reply with no item at all is demoted to nothing, never to an invented item", () => {
    const sample = [{ id: "a", speaker: "A" as const, text: "Take it twice a day." }];
    const v = verifyEvidence(sample, { items: [], planStatus: [] }, "B", DEMO_PLAN.items);
    expect(v.items).toEqual([]);
    expect(v.dropped).toBe(0);
  });
});
