import { describe, expect, it } from "vitest";
import { AUTH_COPY } from "@/features/auth/ui/copy";
import { countWords, literalLint, MAX_WORDS } from "@/lib/literalLint";

/** Every string in the copy, with functions called on a sample address. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return [String((value as (s: string) => string)("me@example.test"))];
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

describe("log-in and sign-up copy", () => {
  const all = strings(AUTH_COPY);

  it("has copy to check", () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it("every sentence is short and literal: no idiom, at most 15 words, one command at a time", () => {
    for (const text of all) {
      // Labels such as "Sign up" have no full stop; each full sentence inside a longer string is checked on its own.
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        expect(literalLint(sentence).failures, sentence).toEqual([]);
        expect(countWords(sentence), sentence).toBeLessThanOrEqual(MAX_WORDS);
      }
    }
  });

  it("the guest warning says what is left behind, in 15 words or fewer", () => {
    expect(AUTH_COPY.login.guestWarning).toMatch(/guest/);
    expect(countWords(AUTH_COPY.login.guestWarning)).toBeLessThanOrEqual(15);
  });

  it("the code texts do not say the address is new or taken, and name the 6 digits", () => {
    const text = `${AUTH_COPY.code.body("me@example.test")} ${AUTH_COPY.forgot.codeIntro("me@example.test")}`;
    expect(text).not.toMatch(/already|new account|taken|registered|no account|not found|does not exist/i);
    expect(text).toMatch(/^If /);
    expect(text).toMatch(/6-digit/);
  });
});
