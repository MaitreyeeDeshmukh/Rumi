import { describe, expect, it } from "vitest";
import { isRecoveryCode, newRecoveryCode, normaliseRecoveryCode } from "@/features/memory/recoveryCode";
import { tagFromCode } from "@/features/memory/tag";

const SECRET = "s".repeat(32);

describe("recovery code", () => {
  it("generated codes are valid and unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const c = newRecoveryCode();
      expect(isRecoveryCode(c)).toBe(true);
      seen.add(c);
    }
    expect(seen.size).toBe(1000);
  });

  it("rejects wrong shapes, including a trailing newline", () => {
    const good = "ABCDE-FGHJK-LMNPQ-RSTUV";
    expect(isRecoveryCode(good)).toBe(true);
    expect(isRecoveryCode(good + "\n")).toBe(false);
    expect(isRecoveryCode("\n" + good)).toBe(false);
    expect(isRecoveryCode(good.toLowerCase())).toBe(false);
    expect(isRecoveryCode("ABCDE-FGHJK-LMNPQ-RSTU0")).toBe(false);
    expect(isRecoveryCode("ABCDEFGHJKLMNPQRSTUV")).toBe(false);
    expect(isRecoveryCode("")).toBe(false);
  });

  it("normalises lower case, dashless and padded input", () => {
    const good = "ABCDE-FGHJK-LMNPQ-RSTUV";
    expect(normaliseRecoveryCode("abcde-fghjk-lmnpq-rstuv")).toBe(good);
    expect(normaliseRecoveryCode("abcdefghjklmnpqrstuv")).toBe(good);
    expect(normaliseRecoveryCode("  ABCDE FGHJK LMNPQ RSTUV \n")).toBe(good);
    expect(normaliseRecoveryCode("abcdefghjklmnpqrstu")).toBeNull();
    expect(normaliseRecoveryCode("abcdefghjklmnpqrstuv0")).toBeNull();
    expect(normaliseRecoveryCode("abcdefghjk\nlmnpqrstuv")).toBeNull();
    expect(normaliseRecoveryCode("abcdefghjklmnpqrstuO")).toBeNull();
  });
});

describe("tagFromCode", () => {
  const a = "ABCDE-FGHJK-LMNPQ-RSTUV";
  const b = "ABCDE-FGHJK-LMNPQ-RSTUW";

  it("is deterministic, prefixed, 34 characters and does not contain the code", () => {
    const t = tagFromCode(a, SECRET);
    expect(t).toBe(tagFromCode(a, SECRET));
    expect(t).toMatch(/^u_[0-9a-f]{32}$/);
    expect(t).not.toContain(a);
  });

  it("two different codes never map to one tag, and a different secret gives a different tag", () => {
    expect(tagFromCode(a, SECRET)).not.toBe(tagFromCode(b, SECRET));
    const tags = new Set<string>();
    for (let i = 0; i < 500; i++) tags.add(tagFromCode(newRecoveryCode(), SECRET));
    expect(tags.size).toBe(500);
    expect(tagFromCode(a, SECRET)).not.toBe(tagFromCode(a, "t".repeat(32)));
  });

  it("refuses a bad code or a short secret", () => {
    expect(() => tagFromCode("abc", SECRET)).toThrow();
    expect(() => tagFromCode(a + "\n", SECRET)).toThrow();
    expect(() => tagFromCode(a, "short")).toThrow();
    expect(() => tagFromCode(a, "s".repeat(31))).toThrow();
  });
});

describe("normaliseRecoveryCode is ASCII-only", () => {
  const good = "ABCDE-FGHJK-LMNPQ-RSTUV";
  it("does not let Unicode case folding turn other characters into code letters", () => {
    expect(normaliseRecoveryCode("ſBCDEFGHJKLMNPQRSTUV")).toBeNull(); // long s would upper-case to S
    expect(normaliseRecoveryCode("ﬀCDEFGHJKLMNPQRSTUV")).toBeNull(); // ff ligature would upper-case to FF
    expect(normaliseRecoveryCode("ıBCDEFGHJKLMNPQRSTUV")).toBeNull(); // dotless i
    expect(normaliseRecoveryCode("АBCDEFGHJKLMNPQRSTUV")).toBeNull(); // Cyrillic A
  });
  it("still accepts what a person types: lower case, spaces, dashes, a trailing newline", () => {
    expect(normaliseRecoveryCode("abcdefghjklmnpqrstuv")).toBe(good);
    expect(normaliseRecoveryCode(" abcde fghjk-lmnpq rstuv \n")).toBe(good);
  });
  it("rejects look-alike separators and characters outside the alphabet", () => {
    expect(normaliseRecoveryCode("ABCDE FGHJKLMNPQRSTUV")).toBeNull(); // no-break space inside
    expect(normaliseRecoveryCode("ABCDE–FGHJKLMNPQRSTUV")).toBeNull(); // en dash
    expect(normaliseRecoveryCode("ABCDEFGHJKLMNPQRSTU0")).toBeNull();
    expect(normaliseRecoveryCode("ABCDEFGHJKLMNPQRSTUO")).toBeNull();
  });
});

describe("tagFromCode: the secret", () => {
  const code = "ABCDE-FGHJK-LMNPQ-RSTUV";
  it("undefined, short and whitespace-only secrets all give the same clear error", () => {
    for (const secret of [undefined as never, "", "a".repeat(31), " ".repeat(40), " ".repeat(10) + "a".repeat(22), "\n".repeat(33)]) {
      expect(() => tagFromCode(code, secret)).toThrow("bad memory key");
    }
  });
  it("a long enough secret works, and a different secret gives a different tag", () => {
    expect(tagFromCode(code, "a".repeat(32))).toMatch(/^u_[0-9a-f]{32}$/);
    expect(tagFromCode(code, "a".repeat(32))).not.toBe(tagFromCode(code, "a".repeat(33)));
  });
});
