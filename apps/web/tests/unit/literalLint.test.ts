import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IDIOM_PATTERNS, MAX_WORDS, countWords, lintCodes, literalLint } from "@/lib/literalLint";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${String.fromCharCode(97 + (i % 26))}${"x".repeat(Math.floor(i / 26))}`).join(" ");
const reasons = (text: string) => literalLint(text).failures.map((f) => f.reason);

describe("sentence length", () => {
  it("14 and 15 words pass, 16 fails", () => {
    expect(MAX_WORDS).toBe(15);
    expect(literalLint(`${words(14)}.`).ok).toBe(true);
    expect(literalLint(`${words(15)}.`).ok).toBe(true);
    expect(reasons(`${words(16)}.`)).toEqual(["too_long"]);
  });

  it("a missing space after a full stop does not hide a 16th word", () => {
    const text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen.sixteen";
    expect(countWords(text)).toBe(16);
    expect(reasons(text)).toEqual(["too_long"]);
  });

  it("an abbreviation does not split a long sentence into two short ones", () => {
    const text = "Please ask Dr. Lee about the pain that started last week when I walked to the shop.";
    expect(countWords(text)).toBe(17);
    expect(reasons(text)).toEqual(["too_long"]);
  });

  it("hyphens and extra whitespace do not hide words", () => {
    expect(reasons(`${words(8)}-${words(8).replace(/ /g, "-")}.`)).toEqual(["too_long"]);
    expect(literalLint(`${words(15).replace(/ /g, "   ")}.`).ok).toBe(true);
  });

  it("counts a decimal or a comma-number as one word", () => {
    expect(countWords("Take 2.5 tablets from 1,000 left.")).toBe(6);
  });

  it("a sentence can fail for two reasons and both are reported", () => {
    expect(reasons(`${words(15)} a bit.`)).toEqual(["too_long", "idiom"]);
  });
});

describe("idioms", () => {
  it.each([
    "I am a bit nervous.",
    "I FIGURED it out.",
    "We are still figuring out the plan.",
    "She said she ran through the list.",
    "Try to hang in there.",
    "Try to hang-in-there.",
    "I am hanging in there.",
    "Do not cut corners.",
    "He was cutting corners.",
    "I am all ears.",
    "It is a long shot.",
    "We are in the same boat.",
    "I am on the fence.",
    "It is sort of sad.",
    "I feel kind of tired.",
    "Keep in mind that I need time.",
    "Please keep an eye on it.",
    "I feel a little bit tired.",
    "Take it easy.",
    "a\n   bit tired",
  ])("flags %s", (text) => {
    expect(reasons(text)).toContain("idiom");
  });

  it("matches whole words only, so near-misses are not idioms", () => {
    expect(literalLint("I ate a bite of toast.").ok).toBe(true);
    expect(literalLint("That was a bitter pill.").ok).toBe(true);
    expect(literalLint("The heads upstairs are quiet.").ok).toBe(true);
    expect(literalLint("I sorted the forms.").ok).toBe(true);
    expect(literalLint("Be kinder of heart.").ok).toBe(true);
    expect(literalLint("I have a cut on my finger.").ok).toBe(true);
    expect(literalLint("The figure is on the page.").ok).toBe(true);
    expect(literalLint("I want to ask what to do next.").ok).toBe(true);
    expect(literalLint("That is an extra bit of toast.").ok).toBe(true);
  });

  it("F-13: 'what kind of' and 'this sort of' ask about a type, they do not hedge", () => {
    for (const q of ["What kind of pain is it?", "What sort of food do you eat?", "It is the sort of thing I forget.", "Which kind of pill is it?", "Is this kind of pain new?", "Any kind of help is fine."]) {
      expect(literalLint(q).ok, q).toBe(true);
    }
  });

  it("invisible characters inside a word do not hide an idiom", () => {
    expect(reasons("I am a b​it sad.")).toContain("idiom");
    expect(reasons("I am a b­it sad.")).toContain("idiom");
  });

  it("the list is large and every pattern compiles", () => {
    expect(IDIOM_PATTERNS.length).toBeGreaterThan(50);
    for (const p of IDIOM_PATTERNS) expect(() => new RegExp(p, "u")).not.toThrow();
  });
});

describe("double commands", () => {
  it("two commands in one sentence fail", () => {
    expect(reasons("Open the door and sit down.")).toEqual(["double_command"]);
    expect(reasons("Please open the door and then sit down.")).toEqual(["double_command"]);
    expect(reasons("Come back in four weeks and bring the diary.")).toEqual(["double_command"]);
  });

  it("F-13: commands chained with a comma or a semicolon, and the verbs rest and see, count", () => {
    expect(reasons("Open the door, sit down.")).toEqual(["double_command"]);
    expect(reasons("Come back in four weeks, bring the diary.")).toEqual(["double_command"]);
    expect(reasons("Rest; see the nurse.")).toEqual(["double_command"]);
    expect(reasons("See the nurse and rest.")).toEqual(["double_command"]);
    expect(reasons("Take the form, sign it and give it back.")).toEqual(["double_command"]);
  });

  it("a list of things is not a list of commands", () => {
    expect(literalLint("Bring water, snacks, and a book.").ok).toBe(true);
    expect(literalLint("Write down when it starts, how strong it is, and what you were doing.").ok).toBe(true);
    expect(literalLint("I will rest, then I will go.").ok).toBe(true);
  });

  it("one command passes, and so does a second clause that is not a command", () => {
    expect(literalLint("Open the door.").ok).toBe(true);
    expect(literalLint("Write down when it starts and how strong it is.").ok).toBe(true);
    expect(literalLint("I want to ask what to do and when.").ok).toBe(true);
    expect(literalLint("I will open the door and sit down.").ok).toBe(true);
  });
});

describe("whole texts", () => {
  it("two good sentences and one bad return exactly one failure naming the bad sentence", () => {
    const r = literalLint("I have a headache. It started this week. Please run through the steps.");
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual([{ sentence: "Please run through the steps.", reason: "idiom" }]);
  });

  it("empty text is fine and newlines separate sentences", () => {
    expect(literalLint("").ok).toBe(true);
    expect(literalLint("short line\nanother short line").ok).toBe(true);
  });
});

describe("lintCodes", () => {
  it("returns soft guard codes only, deduplicated, in a fixed order", () => {
    expect(lintCodes(["Open the door and sit down.", "I am a bit nervous.", `${words(16)}.`, "I am a bit sad."])).toEqual([
      "lint_too_long",
      "lint_idiom",
      "lint_double_command",
    ]);
    expect(lintCodes(["I have a headache.", "It hurts."])).toEqual([]);
    expect(lintCodes([])).toEqual([]);
  });
});

describe("no lookbehind (I-078): the former lookbehind rules behave the same", () => {
  it("an idiom at the very start or end of the text is found", () => {
    expect(reasons("A bit sad.")).toContain("idiom");
    expect(reasons("Sort of sad.")).toContain("idiom");
    expect(reasons("I am sad a bit")).toContain("idiom");
    expect(reasons("It was kind of")).toContain("idiom");
  });

  it("an idiom glued to a letter, digit or apostrophe in front of it is not one", () => {
    expect(reasons("Ka bit sad.").includes("idiom")).toBe(false);
    expect(reasons("I have 5a bit.").includes("idiom")).toBe(false);
    expect(reasons("The tab bit me.").includes("idiom")).toBe(false);
    expect(reasons("It is o'sort of thing.").includes("idiom")).toBe(false);
  });

  it("an idiom after punctuation or a hyphen is found", () => {
    expect(reasons("Yes, a bit.")).toContain("idiom");
    expect(reasons("It is (a bit) sad.")).toContain("idiom");
    expect(reasons("Is it well-kind of sad?")).toContain("idiom");
  });

  it("kind of / sort of is a hedge unless a type word comes right before it", () => {
    for (const ok of ["What kind of pain is it?", "A kind of rash.", "Some sort of rash.", "I have the same kind of pain.", "One kind of pill helps."]) expect(literalLint(ok).ok, ok).toBe(true);
    for (const bad of ["I feel kind of sad.", "Not what I feel, kind of sad.", "It is sort of sad.", "A kind of kind of sad.", "What kind of kind of sad."]) {
      expect(reasons(bad), bad).toContain("idiom");
    }
  });

  it("a type word that is only part of a longer word does not excuse the hedge", () => {
    expect(reasons("Is it the anything kind of thing?")).toContain("idiom");
    expect(reasons("I feel brand kind of sad.")).toContain("idiom");
  });

  it("the source has no lookbehind", () => {
    expect(readFileSync(join(__dirname, "../../src/lib/literalLint.ts"), "utf8")).not.toContain("(?<");
  });
});
