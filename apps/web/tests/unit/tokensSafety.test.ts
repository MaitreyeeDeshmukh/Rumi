import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractAmounts, numberTokens, splitSentences } from "@/lib/text/tokens";

const source = (rel: string): string => readFileSync(resolve(__dirname, "../..", rel), "utf8");

describe("tokens.ts is safe to ship to the browser and cheap on hostile input", () => {
  it("contains no regex lookbehind (Safari before 16.4 cannot load it)", () => {
    expect(source("src/lib/text/tokens.ts")).not.toMatch(/\(\?<[=!]/);
  });

  it("stays linear on one very long digit run (it used to be quadratic: 4 s at 30,000 characters)", () => {
    const started = Date.now();
    extractAmounts("1".repeat(30_000));
    numberTokens("1".repeat(30_000));
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("stays linear on repeated unit-like text and on long whitespace runs", () => {
    const started = Date.now();
    extractAmounts("5 mg ".repeat(10_000));
    extractAmounts("1 ".repeat(60_000)); // many numbers: a per-number copy of the rest of the text would be quadratic
    extractAmounts("5" + " ".repeat(30_000) + "mg");
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("still finds amounts after the rewrite, including a unit after a few spaces but not after many", () => {
    expect(extractAmounts("take 500 mg and 5mg")).toEqual([
      { value: "500", unit: "mg" },
      { value: "5", unit: "mg" },
    ]);
    expect(extractAmounts("5          mg")).toEqual([]);
    expect(extractAmounts("12.5 mg, 1,000 mg")).toEqual([
      { value: "12.5", unit: "mg" },
      { value: "1000", unit: "mg" },
    ]);
  });

  it("never returns empty segments", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   \n\n  ")).toEqual([]);
    expect(splitSentences("Hi.  ")).toEqual(["Hi."]);
    expect(splitSentences("Hi.\n")).toEqual(["Hi."]);
  });

  it("sentence splitting without lookbehind keeps terminators and treats runs of punctuation as one boundary", () => {
    expect(splitSentences("Wait... What? Really! Ok.")).toEqual(["Wait...", "What?", "Really!", "Ok."]);
    expect(splitSentences("One.\n\n  Two.  Three")).toEqual(["One.", "Two.", "Three"]);
    expect(splitSentences("a.b is not a boundary. This is.")).toEqual(["a.b is not a boundary.", "This is."]);
  });
});
