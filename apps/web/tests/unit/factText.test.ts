import { describe, expect, it } from "vitest";
import { factText, factStrings } from "@/features/memory/factText";
import { MAX_CUSTOM_WORDS, SUPPORT_PRESETS, presetText } from "@/features/support/presets";
import { HELP_LEVELS, PACING_KEYS, PLAN_ITEM_KINDS, SUPPORT_PRESET_IDS } from "@/features/shared/constants";

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe("presets", () => {
  it("ids p1..p6 match the contract and the text is the agreed wording", () => {
    expect(SUPPORT_PRESETS.map((p) => p.id)).toEqual([...SUPPORT_PRESET_IDS]);
    expect(SUPPORT_PRESETS.map((p) => p.text)).toEqual([
      "Please speak slowly.",
      "Please ask me one question at a time.",
      "Please write down instructions for me.",
      "Please tell me what will happen before it happens.",
      "I may need extra time to answer.",
      "Please tell me before you touch me.",
    ]);
    expect(MAX_CUSTOM_WORDS).toBe(15);
  });

  it("lookup is own-property only", () => {
    expect(presetText("p1")).toBe("Please speak slowly.");
    for (const k of ["constructor", "__proto__", "toString", "hasOwnProperty", "p9", ""]) expect(presetText(k)).toBeUndefined();
  });
});

describe("factText", () => {
  const all: [string, string, number | undefined][] = [
    ...SUPPORT_PRESET_IDS.map((k): [string, string, undefined] => ["support_pref", k, undefined]),
    ...PACING_KEYS.map((k): [string, string, undefined] => ["pacing", k, undefined]),
    ...PLAN_ITEM_KINDS.flatMap((k) => HELP_LEVELS.map((l): [string, string, number] => ["help_level", k, l])),
  ];

  it("every sentence it can produce is at most 15 words and has no digits", () => {
    expect(all.length).toBe(6 + 2 + 12);
    for (const [kind, key, level] of all) {
      const t = factText(kind, key, level);
      expect(t, `${kind}:${key}:${level}`).not.toBeNull();
      expect(words(t as string)).toBeLessThanOrEqual(15);
      expect(t as string).not.toMatch(/\d/);
    }
  });

  it("presets and pacing come from the one preset table", () => {
    expect(factText("support_pref", "p3")).toBe("Please write down instructions for me.");
    expect(factText("pacing", "one_question")).toBe("Please ask me one question at a time.");
    expect(factText("pacing", "extra_time")).toBe("I may need extra time to answer.");
  });

  it("help level text is a template over fixed words", () => {
    expect(factText("help_level", "question", 2)).toBe("When I practice asking my questions, I needed a sentence with blanks last time.");
    expect(factText("help_level", "concern", 0)).toBe("When I practice explaining my problem, I needed no help last time.");
  });

  it("rejects unknown kinds, keys, levels and prototype keys", () => {
    expect(factText("focus_pref", "last_focus")).toBeNull();
    expect(factText("diagnosis", "p1")).toBeNull();
    expect(factText("support_pref", "p9")).toBeNull();
    expect(factText("support_pref", "p1", 1)).toBeNull();
    expect(factText("pacing", "p2")).toBeNull();
    expect(factText("help_level", "question")).toBeNull();
    expect(factText("help_level", "question", 4)).toBeNull();
    expect(factText("help_level", "question", 1.5)).toBeNull();
    expect(factText("help_level", "other", 1)).toBeNull();
    for (const k of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(factText("support_pref", k)).toBeNull();
      expect(factText("pacing", k)).toBeNull();
      expect(factText("help_level", k, 1)).toBeNull();
      expect(factText(k, "p1")).toBeNull();
    }
  });
});

describe("factStrings", () => {
  it("dedupes sentences (p2 and one_question are the same sentence) and drops invalid facts", () => {
    const out = factStrings([
      { kind: "support_pref", key: "p2" },
      { kind: "pacing", key: "one_question" },
      { kind: "support_pref", key: "p1" },
      { kind: "support_pref", key: "zzz" },
    ]);
    expect(out).toEqual(["Please ask me one question at a time.", "Please speak slowly."]);
  });
});
