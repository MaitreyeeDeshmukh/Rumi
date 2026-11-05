import { describe, expect, it } from "vitest";
import { crisisTier, isCrisis } from "@/lib/crisis";
import { ROAST_BENIGN, ROAST_IDEATION, ROAST_INDIRECT } from "./crisisCorpus";

const BRAILLE = String.fromCodePoint(0x2800);
const MONGOLIAN = String.fromCodePoint(0x180e);
const spaced = (s: string, sep: string): string => s.split("").join(sep);

// Roast findings H-1 to H-3 (07 D43). Every phrase here must show the card at once (tier 1).
const CERTAIN: string[] = [
  // H-1
  "off myself", "I'll off myself", "I want to off myself", "thinking of offing myself", "im gonna off myself",
  // H-2: ellipsis, line breaks, fillers
  "I want to... die", "I want to … die", "i want to\ndie", "i want to kill\nmyself", "I want to. Die.", "I just want to, like, die",
  "i want to, you know, kill myself", "I really, honestly want to die", "I wish I was, like, dead", "my husband, like, hits me",
  "I think I am, like, having a heart attack", "I want to end... my life",
  // H-3 passive ideation
  "I don't see the point in living", "I'm done with life", "I'm tired of living", "I'm tired of being alive", "I don't deserve to live",
  "I shouldn't be alive", "I should just die", "no one would miss me if I died", "I wish I could just not exist", "I wish I would never wake up",
  "I can't live like this", "I give up on life", "better to be dead", "dying would be a relief", "I think about dying every day",
  // plan or act
  "I want to jump", "I'm thinking about jumping", "I drank bleach", "I took 30 advil on purpose", "I wrote a goodbye note", "this is my last message",
  "I have a rope ready", "I have pills ready", "I'm going to take all my pills", "I stopped taking my meds so I can die", "I took my whole prescription",
  // spelling
  "ki11 myself", "kill my$elf", "wnat to die", "want 2 die", "i wanna dissapear forever", "w4nt to d1e",
  // third person
  "my friend wants to kill himself", "he is going to kill himself", "my brother says he wants to end his life",
  // Spanish
  "quisiera desaparecer", "quiero acabar con todo",
  // method seeking
  "how many pills to die", "lethal dose", "is it painless to hang yourself", "how many tylenol to overdose",
  // cutting and burning
  "I cut my arms", "I cut my arms last night", "I've cut myself before", "burned myself to feel something", "I cut my thighs", "I relapsed, cutting",
  // abuse
  "my carer shouts and hits me", "she pushes me down the stairs", "he locks me in the room", "my caregiver won't let me eat", "he is going to kill me",
  "he said he will hurt me if I tell", "I am scared to go home because he hits",
  // medical
  "I'm having chest pain", "my chest hurts and my left arm is numb", "my face is drooping and my speech is slurred", "I'm having an allergic reaction and my lips are swelling",
  "worst headache of my life", "I am having trouble breathing", "No, I think I'm having a heart attack", "no, can't breathe",
  "not now, I am having a heart attack", "I'm not lying, I can't breathe",
];

// Vague or ambiguous on their own: no card, but the harness must ask a model (tier 2).
const CHECK: string[] = [
  "severe chest pain", "I'm bleeding a lot", "gonna do it tonight", "my life is pointless", "I don't want to be a burden anymore",
  "my mom's boyfriend touches me", "I scratched my arm until it bled to feel better", "I want to die laughing", "I want to die of embarrassment",
  "I never had suicidal thoughts", "suicide is a topic I want to read about for class", "my class is about suicide prevention",
  "I do not feel safe walking home at night", "I could die if I miss another day of work",
];

// Squashed text must not turn neighbouring words into a phrase (roast: upskill myself, tician, ...).
const NOT_CERTAIN: string[] = [
  "I want to change myself", "I need to change myself", "I try to exchange myself", "I want to upskill myself", "I can skill myself up",
  "I will reshoot myself", "I cut my finger cooking", "I want to introduce myself", "let me introduce myself to the doctor", "I will abandon myself",
  "I need to be more understanding of myself", "I wanna dietary", "I'm gonna dietitian", "I want to dietitian", "I wanna diet", "I wanna dieticians",
  "I should lower my risk of stroke", "tell the doctor about my stroke", "I need to describe my chest pain to the doctor",
  "do you want to diet or exercise more", "i wan t to di scuss my results",
];

describe("tier 1: certain", () => {
  it.each(CERTAIN)("%j", (s) => {
    expect(crisisTier(s)).toBe("certain");
    expect(isCrisis(s)).toBe(true);
  });
});

describe("tier 2: check (never the card by itself)", () => {
  it.each(CHECK)("%j", (s) => {
    expect(crisisTier(s)).toBe("check");
    expect(isCrisis(s)).toBe(false);
  });

  it("plain text is 'none' and the tier is a closed set", () => {
    for (const s of ["", "   ", "I have an appointment on Tuesday", "my knee hurts when i walk", "I want to ask about my medication"]) {
      expect(crisisTier(s)).toBe("none");
    }
  });
});

describe("squashed text needs word edges", () => {
  it.each(NOT_CERTAIN)("%j is not certain", (s) => {
    expect(crisisTier(s)).not.toBe("certain");
  });

  it("still catches run-together and spaced-out spellings of a whole phrase", () => {
    for (const s of ["iwanttodie", "I want to kill myself", "w i s h i w a s d e a d", "m.y. .h.u.s.b.a.n.d. .h.i.t.s. .m.e", "h e a r t a t t a c k i t h i n k i a m h a v i n g a", "t o o m a n y p i l l s"]) {
      // the last two are fragments of longer phrases; only the first four must be certain on their own
      if (s.startsWith("h e a r t") || s.startsWith("t o o")) continue;
      expect(isCrisis(s)).toBe(true);
    }
    expect(isCrisis("i think i am having a h e a r t a t t a c k")).toBe(true);
    expect(isCrisis("i t o o k t o o m a n y p i l l s")).toBe(true);
  });
});

describe("invisible separators (07 H-12)", () => {
  const bases = ["i want to die", "i am going to end my life", "i wish i was dead", "i think i am having a heart attack", "my husband hits me"];
  it.each(bases)("braille blank and Mongolian vowel separator between letters or words: %j", (base) => {
    for (const z of [BRAILLE, MONGOLIAN]) {
      expect(isCrisis(spaced(base, z))).toBe(true);
      expect(isCrisis(base.split(" ").join(`${z} `))).toBe(true);
      expect(isCrisis(base.split(" ").join(z))).toBe(true);
    }
  });
});

describe("negation of medical phrases (07 H-11)", () => {
  it("a leading No with a comma or a sentence break is not a negation of the phrase", () => {
    expect(isCrisis("No, I think I'm having a heart attack")).toBe(true);
    expect(isCrisis("no, can't breathe")).toBe(true);
    expect(isCrisis("No. I can't breathe")).toBe(true);
  });
  it("a direct negation still wins", () => {
    expect(isCrisis("I have no chest pain right now")).toBe(false);
    expect(isCrisis("no, I am not having a heart attack")).toBe(false);
  });
});

describe("independent roast corpus (regression floor, not a safety proof)", () => {
  const all = [...ROAST_IDEATION, ...ROAST_INDIRECT];
  const tiers = all.map((s) => crisisTier(s));
  const certain = tiers.filter((t) => t === "certain").length;
  const check = tiers.filter((t) => t === "check").length;

  it("has the expected sizes", () => {
    expect([ROAST_IDEATION.length, ROAST_INDIRECT.length, ROAST_BENIGN.length]).toEqual([146, 50, 87]);
  });

  it("tier 1 alone catches at least 92% and tier 1 or 2 catches every phrase", () => {
    expect(certain / all.length).toBeGreaterThanOrEqual(0.92);
    expect(all.filter((_, i) => tiers[i] === "none")).toEqual([]);
    expect(certain + check).toBe(all.length);
  });

  it("tier 1 flags none of the 87 benign sentences (tuned on this list, so not a measured false-positive rate)", () => {
    expect(ROAST_BENIGN.filter((s) => isCrisis(s))).toEqual([]);
  });

  it("tier 2 is noisy but bounded: at most a quarter of the benign sentences", () => {
    const checks = ROAST_BENIGN.filter((s) => crisisTier(s) === "check");
    expect(checks.length / ROAST_BENIGN.length).toBeLessThanOrEqual(0.25);
  });
});

// Added after the mutation run: each phrase below pins one rule or exception that no other test covered.
describe("rules pinned by mutation checks", () => {
  it.each([
    "iwant to die",
    "the man next door will hurt me",
    "my face is drooping",
    "speech is slurred",
    "I'm having an allergic reaction",
  ])("tier 1: %j", (s) => {
    expect(crisisTier(s)).toBe("certain");
  });

  it.each([
    "I cut my arm on the glass",
    "I cut my leg while gardening",
    "I want to jump into the pool",
    "I want to jump to conclusions",
    "I want to jump in the queue",
    "I am having chest pain when I climb stairs",
    "I'm having chest pain after meals",
  ])("not tier 1: %j", (s) => {
    expect(crisisTier(s)).not.toBe("certain");
  });
});

describe("want to dye (a typo for die, or hair colour)", () => {
  it("a bare 'want to dye' is tier 1, 'want to dye my hair' is not", () => {
    expect(crisisTier("i want to dye")).toBe("certain");
    expect(crisisTier("I wanna dye.")).toBe("certain");
    expect(crisisTier("I want to dye my hair")).not.toBe("certain");
    expect(crisisTier("I want to dye my hair blue")).toBe("none");
  });
});
