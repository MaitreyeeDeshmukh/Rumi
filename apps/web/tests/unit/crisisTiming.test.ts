import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { crisisTier } from "@/lib/crisis";
import { matchForm, scanInjection, redactPii } from "@/lib/ai/guards/input";
import { adviceCodes, claimsHumanCodes, clinicianFindingCodes, stripUrls } from "@/lib/ai/guards/output";

/**
 * Milliseconds one call takes. A slow first measurement is repeated (best of five) so a busy machine running other
 * test files is not blamed on the pattern; a pattern that really backtracks is slow every time.
 */
function ms(fn: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < 5 && (i === 0 || best >= 50); i++) {
    const t = performance.now();
    fn();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

const repeatTo = (unit: string, chars: number): string => unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);

const BENIGN_RUN_ON =
  "I took the dog out late in the state park and then we ate at a place that was great and then we hit traffic and bit into a sandwich while my brother burned the toast and I drank water ";

const ADVERSARIAL: Array<[string, string]> = [
  ["2000 characters of run-on benign text, no full stop", repeatTo(BENIGN_RUN_ON, 2000)],
  ["medication sentences", repeatTo("take 5 mg 3 times a day and 2 tablets ", 2000)],
  ["words that start with a rule prefix (late, state, create)", repeatTo("late state create estate plate translate relate debate ", 2000)],
  ["took ate drank without stops", repeatTo("took ate drank take drink hit bit burn ", 2000)],
  ["the same word with no spaces", "take".repeat(500)],
  ["letters only, no spaces", "ilatestatewanttotakeamedicineate".repeat(62)],
  ["many short words", repeatTo("a b c d e f g h i j k l m n o p q r s t ", 2000)],
  ["on purpose and deliberately far away", `took ${repeatTo("word ", 1900)} on purpose`],
  ["how many pills", repeatTo("how many pills do i take with food and ", 2000)],
  ["my head on a purposeful note", repeatTo("hit my head on the door and bang my hands on a purpose built bench ", 2000)],
  ["digits and units", repeatTo("5 mg 3 x 2 ml 10 pm 4 am ", 2000)],
  ["commas only", repeatTo("took,ate,drank,", 2000)],
  ["he she they my brother", repeatTo("my brother he she they was is keeps has been always sometimes ", 2000)],
  ["one long word", "a".repeat(2000)],
  ["leet and symbols", repeatTo("w4nt t0 d1e $ @ ! ", 2000)],
];

describe("crisisTier: time on ordinary and adversarial text", () => {
  it.each(ADVERSARIAL)("%s: under 50 ms", (_name, text) => {
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(ms(() => crisisTier(text))).toBeLessThan(50);
  });

  it("a long string is capped: it is answered as 'check' at once (the model decides), never scanned for seconds", () => {
    const text = repeatTo(BENIGN_RUN_ON, 200_000);
    expect(ms(() => crisisTier(text))).toBeLessThan(50);
    expect(crisisTier(text)).toBe("check");
  });

  it("every word the rules know, repeated 400 times, then in pairs, stays under 50 ms (generic over all rules)", () => {
    const source = readFileSync("src/lib/crisis.ts", "utf8");
    const words = [...new Set(source.match(/[a-z]{2,}/g) ?? [])].filter((w) => w.length <= 14).sort();
    expect(words.length).toBeGreaterThan(300);
    let worst = 0;
    let worstWord = "";
    for (const w of words) {
      for (const text of [repeatTo(`${w} `, 2000), repeatTo(w, 2000), repeatTo(`i ${w} my `, 2000)]) {
        const t = ms(() => crisisTier(text));
        if (t > worst) [worst, worstWord] = [t, w];
      }
    }
    expect(worst, `slowest word: ${worstWord}`).toBeLessThan(100); // a backtracking rule takes whole seconds; 100 ms leaves room for a busy machine
  }, 60_000);

  it("random mixes of the rule vocabulary, with and without spaces, stay under 50 ms", () => {
    const source = readFileSync("src/lib/crisis.ts", "utf8");
    const words = [...new Set(source.match(/[a-z]{2,}/g) ?? [])].filter((w) => w.length <= 14).sort();
    let seed = 12345;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      let text = "";
      while (text.length < 2000) text += words[Math.floor(rnd() * words.length)] + (i % 2 === 0 ? " " : "");
      worst = Math.max(worst, ms(() => crisisTier(text.slice(0, 2000))));
    }
    expect(worst).toBeLessThan(50);
  });
});

describe("the other pattern modules on the same text", () => {
  it.each(ADVERSARIAL)("%s: matchForm, injection, PII, advice and link checks each under 50 ms", (_name, text) => {
    for (const fn of [
      () => matchForm(text),
      () => scanInjection(text),
      () => redactPii(text),
      () => adviceCodes(text, { items: [], thin: true }),
      () => clinicianFindingCodes(text, { items: [], thin: true }),
      () => claimsHumanCodes(text),
      () => stripUrls(text),
    ]) {
      expect(ms(fn)).toBeLessThan(50);
    }
  });
});
