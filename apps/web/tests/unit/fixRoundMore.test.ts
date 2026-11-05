/** Cases added after the mutation run of the fix round: each pins one rule that no other test pinned on its own. */
import { describe, expect, it } from "vitest";
import { confirmCovered } from "@/features/practice/confirmCovered";
import { practiceFallback } from "@/features/practice/fallback";
import { planFallback } from "@/features/plan/fallback";
import { verifyEvidence } from "@/features/recap/verifyEvidence";
import { level1Codes } from "@/features/sayit/level1";
import { PracticeRequest } from "@/features/shared/schemas";
import type { RecapItem, Speaker, TranscriptLine } from "@/features/shared/types";
import { DEMO_PLAN } from "@/fixtures/demoPlan";
import { literalLint } from "@/lib/literalLint";
import { STOP_LINE } from "../../prompts/persona";

const lines1 = (text: string, speaker: Speaker = "A"): TranscriptLine[] => [{ id: "l1", speaker, text }];
const item = (section: RecapItem["section"], text: string): RecapItem => ({ section, text, evidence: ["l1"] });
const accepted = (lines: TranscriptLine[], it: RecapItem): boolean => verifyEvidence(lines, { items: [it], planStatus: [] }, "B").items.length > 0;
const say = (text: string) =>
  practiceFallback(
    PracticeRequest.parse({
      plan: DEMO_PLAN,
      turns: [
        { role: "clinician", text: "Hi." },
        { role: "me", text },
      ],
      focus: "whole",
      companionName: "Rumi",
    }),
  );

describe("F-5 a medicine the lists do not know still owns its dose", () => {
  it("the name before the colon is bound to its own dose", () => {
    const l = lines1("Take warfarin 5 mg and zorbex 200 mg.");
    expect(accepted(l, item("medications", "Zorbex: 5 mg."))).toBe(false);
    expect(accepted(l, item("medications", "Zorbex: 200 mg."))).toBe(true);
  });
});

describe("F-3 opposite words and negators, each on its own", () => {
  // These sentences are long enough that the one changed word still passes the 75% coverage rule,
  // so only the meaning check can reject them.
  it("before/after, more/less, increase/decrease", () => {
    expect(accepted(lines1("Take the small blue pill before breakfast daily."), item("instructions", "Take the small blue pill after breakfast daily."))).toBe(false);
    expect(accepted(lines1("Take the small blue pill before breakfast daily."), item("instructions", "Take the small blue pill before breakfast daily."))).toBe(true);
    expect(accepted(lines1("Drink more of the clear cold water every morning."), item("instructions", "Drink less of the clear cold water every morning."))).toBe(false);
    expect(accepted(lines1("Increase the slow evening walking time each week."), item("instructions", "Decrease the slow evening walking time each week."))).toBe(false);
  });

  it.each([
    ["Please discontinue the small blue medicine today.", "Please take the small blue medicine today."],
    ["Please skip the small blue medicine today.", "Please take the small blue medicine today."],
    ["Please quit the small blue medicine today.", "Please take the small blue medicine today."],
    ["Please avoid the small blue medicine today.", "Please take the small blue medicine today."],
  ])("%s is not %s", (src, out) => {
    expect(accepted(lines1(src), item("instructions", out))).toBe(false);
  });
});

describe("F-1 more stop cases", () => {
  it("'I can't stop the shaking' is about the person, not a request", () => {
    expect(say("I can't stop the shaking").clinicianSay).not.toBe(STOP_LINE);
  });

  it("'tired' in a long turn with no symptom words is not a request", () => {
    expect(say("I'm tired and I would like to talk about my knee please").clinicianSay).not.toBe(STOP_LINE);
    expect(say("I'm tired of this").clinicianSay).toBe(STOP_LINE);
  });
});

describe("F-15 half of the item's words, as well as two", () => {
  it("two shared words are not enough when the item has many more", () => {
    const plan = { ...DEMO_PLAN, items: [{ id: "x1", text: "Please explain headache diary storage options clearly", kind: "question" as const, source: "user" as const, enabled: true }] };
    expect(confirmCovered(["x1"], plan, ["headache diary"])).toEqual([]);
    expect(confirmCovered(["x1"], plan, ["explain headache diary storage"])).toEqual(["x1"]);
  });
});

describe("F-10 the starter is short even when every word is neutral", () => {
  it("more than four words is a statement", () => {
    expect(level1Codes("What else? You can start with: I am not sure ...")).toEqual([]);
    expect(level1Codes("What else? You can start with: I am not sure at all ...")).toEqual(["level1_statement"]);
  });
});

describe("F-13 a double command must start the sentence", () => {
  it("a sentence that does not begin with a command is not flagged", () => {
    expect(literalLint("Tom said hello, sit down and wait.").ok).toBe(true);
    expect(literalLint("Sit down and wait.").ok).toBe(false);
  });
});

describe("F-17 control characters are not copied", () => {
  it("a bell or other control character inside the text is removed", () => {
    const r = planFallback({ rawText: "My knee\u0007 hurts.\u0001", companionName: "Rumi" });
    expect(r.plan.mainConcern).toBe("My knee hurts.");
    expect(r.plan.items[0].text).toBe("I want to tell you: My knee hurts.");
    expect(/\p{Cc}/u.test(r.plan.items[0].text + r.plan.mainConcern)).toBe(false);
  });
});
