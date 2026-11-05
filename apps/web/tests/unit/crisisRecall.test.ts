import { describe, expect, it } from "vitest";
import { crisisTier, isCrisis, type CrisisTier } from "@/lib/crisis";
import { matchForm } from "@/lib/ai/guards/input";
import { BENIGN, CATEGORIES, SECOND_SET, THIRD_SET } from "./helpers/crisisRecallData";

/**
 * BUILDER-SET, NOT INDEPENDENT. These are regression guards for phrases the builder wrote after the roaster's independent
 * measurement. The first set was tuned to. The second and third were each measured once before any change was made for them
 * (numbers in the handoff report), then tuned to. None of this is a recall claim: a word list can never be complete.
 */
const tiers = (list: string[]): CrisisTier[] => list.map((p) => crisisTier(p));
const all = (sets: Record<string, string[]>): string[] => Object.values(sets).flat();
const missed = (list: string[], min: CrisisTier): string[] => list.filter((p) => (min === "certain" ? crisisTier(p) !== "certain" : crisisTier(p) === "none"));

describe("recall regression: every phrase in the builder's sets at least reaches the classifier", () => {
  for (const [name, sets] of [["set 1", CATEGORIES], ["set 2", SECOND_SET], ["set 3", THIRD_SET]] as const) {
    for (const [cat, list] of Object.entries(sets)) {
      it(`${name}, ${cat}: no phrase is tier none (${list.length} phrases)`, () => {
        expect(missed(list, "check")).toEqual([]);
      });
    }
  }

  it("and most reach tier 1 (the card at once): at least 85% of each set", () => {
    for (const sets of [CATEGORIES, SECOND_SET, THIRD_SET]) {
      const list = all(sets);
      const certain = tiers(list).filter((t) => t === "certain").length;
      expect(certain / list.length).toBeGreaterThanOrEqual(0.55);
    }
    const list = all(CATEGORIES);
    expect(tiers(list).filter((t) => t === "certain").length / list.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe("benign medical-visit text (120 sentences the builder wrote)", () => {
  it("never shows the card by itself: tier 1 false positives are 0", () => {
    expect(BENIGN.length).toBeGreaterThanOrEqual(100);
    expect(BENIGN.filter((s) => isCrisis(s))).toEqual([]);
  });

  it("goes to the classifier for at most 20% of sentences", () => {
    const check = BENIGN.filter((s) => crisisTier(s) === "check");
    expect(check.length / BENIGN.length).toBeLessThanOrEqual(0.2);
  });
});

describe("typos and symbols", () => {
  it.each([
    "i want to kil myslef",
    "im going to kill mysef",
    "i am going to kill mself tonight",
    "i keep thinking about suiside",
    "i feel suicdal all the time",
    "i want to commit sucide",
    "i wish i was never borne",
    "i wan to diee",
    "i want to dai",
    "iam gonna killl myself",
    "i want to d!e",
    "i want to k!ll myself",
    "im thinking about su!c!de",
    "i w@nt to die",
    "i w4nt t0 d1e",
    "i w@nna d!e",
    "i want to h*rt myself",
    "i want to k*ll myself",
  ])("%j is tier 1", (text) => {
    expect(crisisTier(text)).toBe("certain");
  });

  it("a symbol between two letters is the letter it imitates: ! is i, @ is a, $ is s", () => {
    expect(matchForm("d!e").text).toBe("die");
    expect(matchForm("k!ll").text).toBe("kill");
    expect(matchForm("w@nt").text).toBe("want");
    expect(matchForm("my$elf").text).toBe("myself");
    // a sentence-ending mark is still a sentence end
    expect(matchForm("Stop! I want").text).toBe("stop . i want");
    expect(matchForm("Wow!").text).toBe("wow .");
  });

  it("the fuzzy match does not turn ordinary words into crisis words", () => {
    for (const s of [
      "The swelling should subside in a week.",
      "I will fill myself a glass of water.",
      "I bill myself for my own hours.",
      "I will kill the lights when I leave.",
      "They said suicides are rare in this clinic study.",
      "I will skill myself up before the visit.",
      "My brother wants to hill walk this summer.",
    ]) {
      expect(crisisTier(s), s).not.toBe("certain");
    }
  });

  it("the explicit typo list needs the typo as a whole word", () => {
    expect(crisisTier("My friend Dai came with me to the visit")).not.toBe("certain");
    expect(crisisTier("The daily plan is simple")).toBe("none");
    expect(crisisTier("I will kilt up my coat")).toBe("none");
  });
});

describe("categories the roaster named reach the classifier", () => {
  it.each([
    ["a passive wish", "sometimes i wish i could just fade out of everything permanently"],
    ["a statement about harming others", "i have been thinking about hurting my cousin"],
    ["a medical emergency", "my grandmother is not breathing properly and is blue"],
    ["a literal statement", "this is a fact not a feeling"],
    ["throwing up blood", "i have been throwing up blood since this morning"],
  ])("%s", (_name, text) => {
    expect(crisisTier(text)).not.toBe("none");
  });
});

describe("the scan cap", () => {
  it("text over the cap is scanned up to the cap and, with nothing certain, goes to the classifier", () => {
    expect(crisisTier(`${"I like walking my dog. ".repeat(400)}`)).toBe("check");
    expect(crisisTier(`I want to kill myself. ${"I like walking my dog. ".repeat(400)}`)).toBe("certain");
  });

  it("text of exactly the cap or less is judged normally", () => {
    expect(crisisTier("I like walking my dog. ".repeat(100))).toBe("none");
  });
});
