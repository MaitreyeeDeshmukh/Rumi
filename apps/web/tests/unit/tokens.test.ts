import { describe, expect, it } from "vitest";
import {
  amountKey,
  containsAllTokens,
  contentWords,
  extractAmounts,
  foldDigits,
  normalizeText,
  numberTokens,
  sharesContentWord,
  splitSentences,
  wordSet,
} from "@/lib/text/tokens";
import { COMMON_DRUGS, CONDITIONS, NUMBER_WORDS, UNITS } from "@/features/shared/lists";

const amounts = (t: string) => extractAmounts(t).map(amountKey);

describe("numbers and amounts (the forms the roasters used to slip past the checks)", () => {
  it("glued and spaced units give the same amount", () => {
    expect(amounts("I take 500mg")).toEqual(["500|mg"]);
    expect(amounts("I take 500 mg")).toEqual(["500|mg"]);
    expect(amounts("at 5pm")).toEqual(["5|pm"]);
    expect(amounts("on the 3rd")).toEqual(["3|rd"]);
    expect(amounts("for 20mins")).toEqual(["20|mins"]);
    expect(amounts("3x a day")).toEqual(["3|x"]);
    expect(amounts("for 2weeks")).toEqual(["2|weeks"]);
    expect(amounts("2.5 mg and 12.5 mg")).toEqual(["2.5|mg", "12.5|mg"]);
  });

  it("a longer unit wins over a shorter one", () => {
    expect(amounts("400 mcg")).toEqual(["400|mcg"]);
    expect(amounts("400 mg")).toEqual(["400|mg"]);
  });

  it("a number glued to letters that are not a unit is not an amount, but is still a number token", () => {
    expect(amounts("I have 3headaches")).toEqual([]);
    expect(numberTokens("I have 3headaches")).toEqual(["3"]);
  });

  it("5 mg and 25 mg are different amounts", () => {
    expect(amounts("Warfarin: 5 mg")).not.toEqual(amounts("Take warfarin 25 mg"));
  });

  it("thousands commas are removed and decimals kept", () => {
    expect(numberTokens("1,000 steps and 2.5 mg")).toEqual(["1000", "2.5"]);
  });

  it("fullwidth and Arabic-Indic digits are folded to ASCII", () => {
    expect(numberTokens("５００ mg")).toEqual(["500"]);
    expect(foldDigits("٥٠٠")).toBe("500");
    expect(amounts("٥٠٠ mg")).toEqual(["500|mg"]);
  });

  it("units list is wired into the tokenizer", () => {
    for (const unit of ["mg", "ml", "units", "puffs", "weeks"]) expect(UNITS).toContain(unit);
  });
});

describe("sentence splitting", () => {
  it("keeps titles and abbreviations inside one sentence", () => {
    expect(splitSentences("Dr. Lee said hi. Then he left.")).toEqual(["Dr. Lee said hi.", "Then he left."]);
    expect(splitSentences("Use it, e.g. twice. Done.")).toEqual(["Use it, e.g. twice.", "Done."]);
  });

  it("splits on newlines and question marks", () => {
    expect(splitSentences("dizzy\nheadaches\ntired")).toEqual(["dizzy", "headaches", "tired"]);
    expect(splitSentences("Why? Because.")).toEqual(["Why?", "Because."]);
  });
});

describe("words and whole-token matching", () => {
  it("never treats a substring as a match", () => {
    expect(containsAllTokens("headaches for 13 days", "3")).toBe(false);
    expect(containsAllTokens("see Leeds", "Lee")).toBe(false);
    expect(containsAllTokens("headaches for 13 days", "13 days")).toBe(true);
    expect(wordSet("someone often").has("one")).toBe(false);
  });

  it("content words drop stopwords and short words", () => {
    expect(contentWords("I need a refill for the white pill")).toEqual(["refill", "white", "pill"]);
  });

  it("sharing a content word means same topic, and stopwords alone never count", () => {
    expect(sharesContentWord("numbness in the leg", "I need a refill for the white pill")).toBe(false);
    expect(sharesContentWord("I keep getting headaches", "headaches most afternoons")).toBe(true);
    expect(sharesContentWord("ok", "hi")).toBe(false);
  });

  it("normalizeText keeps accents and folds compatibility forms", () => {
    expect(normalizeText("Muñoz ５")).toBe("Muñoz 5");
    expect(wordSet("Muñoz Zoë")).toEqual(new Set(["muñoz", "zoë"]));
  });
});

describe("shared lists", () => {
  it("are lowercase, non-empty, and keep 'one' out of the number words", () => {
    for (const list of [COMMON_DRUGS, CONDITIONS, NUMBER_WORDS]) {
      expect(list.length).toBeGreaterThan(10);
      for (const w of list) expect(w).toBe(w.toLowerCase());
    }
    expect(NUMBER_WORDS).not.toContain("one");
    expect(COMMON_DRUGS).toContain("ibuprofen");
    expect(CONDITIONS).toContain("diabetes");
  });
});
