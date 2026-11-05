import { describe, expect, it } from "vitest";
import { crisisTier } from "@/lib/crisis";

/** A filler word is also a word some rule groups repeat; the two readings of each repeat must not multiply. */
const FILLERS = ["like", "just", "you know", "really", "honestly", "so", "literally", "actually", "kind of", "sort of", "maybe", "totally", "simply", "fucking", "freaking"];
const PREFIXES = ["i", "im", "ive", "he", "she", "they", "someone", "somebody", "my husband", "my mom", "she keeps", "i have", "i am"];

function best(fn: () => unknown): number {
  let b = Infinity;
  for (let i = 0; i < 3 && (i === 0 || b >= 50); i++) {
    const t = performance.now();
    fn();
    b = Math.min(b, performance.now() - t);
  }
  return b;
}

describe("crisisTier on long runs of one filler word", () => {
  for (const f of FILLERS) {
    it(`"${f}" repeated stays fast after every pronoun or person prefix`, () => {
      for (const p of PREFIXES) {
        const text = `${p} ${`${f} `.repeat(30)}xyz`;
        expect(best(() => crisisTier(text)), `${p} + ${f}`).toBeLessThan(100);
      }
    });
  }
  it("a 2000 character run of 'just' returns at once", () => {
    expect(best(() => crisisTier(`i ${"just ".repeat(399)}xyz`))).toBeLessThan(100);
  });
});
