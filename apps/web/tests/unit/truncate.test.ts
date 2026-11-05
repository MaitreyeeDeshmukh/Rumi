import { describe, expect, it } from "vitest";
import { truncateAtWord } from "@/lib/text/truncate";

describe("truncateAtWord", () => {
  it("leaves short text alone and collapses whitespace", () => {
    expect(truncateAtWord("  a   b\n c ", 20)).toBe("a b c");
  });

  it("cuts at a word boundary, never over the limit", () => {
    const out = truncateAtWord("one two three four five", 14);
    expect(out).toBe("one two three");
    expect(out.length).toBeLessThanOrEqual(14);
  });

  it("a word boundary far from the end is not worth it", () => {
    expect(truncateAtWord("a bbbbbbbbbbbbbbbbbbbb", 10)).toBe("a bbbbbbbb");
  });

  it("cuts a single long token hard", () => {
    expect(truncateAtWord("x".repeat(1900), 170)).toHaveLength(170);
  });

  it("does not leave half of an emoji", () => {
    const out = truncateAtWord("ab\u{1F600}\u{1F600}", 3);
    expect(out).toBe("ab");
  });

  it("a limit of zero gives an empty string", () => {
    expect(truncateAtWord("abc", 0)).toBe("");
  });
});
