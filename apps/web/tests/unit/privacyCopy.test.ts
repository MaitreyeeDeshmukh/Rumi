import { describe, expect, it } from "vitest";
import { PRIVACY_INTRO, PRIVACY_SECTIONS } from "@/app/(site)/privacy/copy";
import { MEMORY_COPY } from "@/features/memory/consentCopy";
import { countWords, literalLint, MAX_WORDS } from "@/lib/literalLint";

const lines = PRIVACY_SECTIONS.flatMap((s) => [s.heading, ...s.lines]);
const all = [PRIVACY_INTRO, ...lines].join(" ").toLowerCase();

describe("privacy page copy", () => {
  it("every sentence is short and literal: no idiom, at most 15 words, one command at a time", () => {
    for (const s of [PRIVACY_INTRO, ...lines]) {
      expect(literalLint(s).failures, s).toEqual([]);
      expect(countWords(s), s).toBeLessThanOrEqual(MAX_WORDS);
    }
  });

  it("says the three true things: stays on the device, goes to the AI company and is not stored, memory stores ids in Rumi's own database", () => {
    expect(all).toMatch(/in your own browser, on your own device/);
    expect(all).toMatch(/words you type are sent to the company that runs the ai/);
    expect(all).toMatch(/does not save those words in its database or in its logs/);
    expect(all).toMatch(/anonymous account id/);
    expect(all).toMatch(/id of each choice/);
    expect(all).toMatch(/rumi.s own database/);
    expect(all).toMatch(/delete everything at any time/);
  });

  it("does not claim that nothing leaves the device (the AI helper sends text out)", () => {
    expect(all).not.toMatch(/does not send them to us or to anyone/);
    expect(all).not.toMatch(/never leaves/);
  });

  it("agrees with the memory switch words on the points they share", () => {
    const memory = [...MEMORY_COPY.body].join(" ").toLowerCase();
    for (const phrase of ["own database", "delete everything at any time", "only the id of each choice"]) expect(memory).toContain(phrase.includes("only") ? "only the id of each choice" : phrase);
    expect(all).toContain("own database");
    expect(all).toContain("delete everything at any time");
  });

  it("names no other company and no recovery code", () => {
    expect(all).not.toMatch(/recovery code|third part/);
  });
});
