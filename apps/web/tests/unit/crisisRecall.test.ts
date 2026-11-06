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

describe("each rule family added in fix round 1 shows the card on its own phrase", () => {
  it.each([
    // passive wishes, permanence
    "i want to turn myself off permanently",
    "maybe i should just turn myself off for good",
    "i dont want to continue living",
    "i do not see why i should keep going",
    "i just want to rest forever",
    "i feel like there is no way out",
    "i want to quit life",
    "i hope i do not wake up tomorrow",
    "i have no reason to be here",
    "i am done being alive",
    "i have decided this is my last week",
    "i will not be alive next week",
    "i want it to all be over",
    "i want to leave this world",
    "there is nothing left for me here",
    "i see no future for myself",
    "life has no meaning for me anymore",
    "i cant do life anymore",
    "i am tired of existing",
    "i want to stop being a person",
    "i keep wishing i would fall asleep and never come back",
    "i want to be gone for good",
    "i wish i could vanish permanently",
    // harm to others
    "i am going to make him bleed",
    "i have thoughts of hurting my kids",
    "i will find him and hurt him",
    "i am angry enough to kill",
    "i would like to see them dead",
    "i want to smash his face in",
    "i want to shoot up the school",
    "i want to burn the house down with them inside",
    "i am thinking about killing my brother",
    "i keep imagining hurting my roommate",
    "i have been having thoughts about hurting the nurse",
    // medical
    "i am throwing up blood",
    "my child stopped breathing",
    "my baby is not responding",
    "he collapsed and is unconscious",
    "i cannot get any air",
    "she is choking and turning blue",
    "he is turning blue",
    "i want too die",
    "my son swallowed a battery",
    "i think i took too much medicine",
    "she is having a seizure",
    "i have been stabbed",
    "someone shot me",
    "i got hit by a car",
    "there is blood in my vomit",
    "the bleeding will not stop",
    "my father is not breathing",
    "my toddler is limp",
    "my face feels numb on one side",
    "i have crushing pressure in my chest",
    "i have chest pain and my left arm is numb",
    "my chest is crushing and my arm tingles",
    "he grabbed his chest and fell on the floor",
    // plans and literal
    "i intend to die",
    "my plan is to overdose this weekend",
    "i plan to end my life",
    "i am not dramatic and i will not be alive next week",
  ])("%j", (text) => {
    expect(crisisTier(text)).toBe("certain");
  });

  it("but the neighbouring ordinary sentences do not", () => {
    for (const s of [
      "I was hit by a car last year and my knee still hurts.",
      "I will hit the road after the visit.",
      "I might hurt my back if I lift that.",
      "I could hit the gym after work.",
      "My baby is not sleeping well at night.",
      "My son is not eating much lately.",
      "I want to see them at the clinic tomorrow.",
      "I am going to find him a chair in the waiting room.",
      "I dont want to hurt my sister so I will tell her calmly.",
      "I am not going to hit anyone, I only want to ask a question.",
      "Life has no spare time for me this month.",
      "I am done being late to my visits.",
    ]) {
      expect(crisisTier(s), s).not.toBe("certain");
    }
  });

  it("words only the broad tier 2 list knows still reach the classifier", () => {
    for (const s of ["i keep thinking about a massacre at school", "the world would be fine without me", "i keep thinking about a weapon"]) {
      expect(crisisTier(s), s).not.toBe("none");
    }
  });

  it("typos and leet together are read: k1l myslef", () => {
    expect(crisisTier("i want to k1l myslef")).toBe("certain");
    expect(crisisTier("i want to k!l myslef")).toBe("certain");
  });
});
