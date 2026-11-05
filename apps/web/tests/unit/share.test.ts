import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION, RECAP_FOOTER, RECAP_TITLES, buildShareText, type ShareSelection } from "@/features/share/buildShareText";
import { buildKitText } from "@/features/share/buildKitText";
import { shouldPlayFinishSound } from "@/features/share/finishSound";
import { defaultSettings, defaultState } from "@/lib/storage";
import type { RumiState } from "@/features/shared/types";

const planItem = (id: string, kind: "concern" | "question" | "accommodation", text: string, enabled = true) => ({ id, text, kind, source: "user" as const, enabled });

function fullState(): RumiState {
  const s = defaultState();
  s.plan = {
    id: "plan-1",
    title: "Visit",
    createdAt: "",
    mainConcern: "I keep getting headaches",
    symptomsInMyWords: [],
    items: [
      planItem("q1", "question", "I want to ask why I get these headaches."),
      planItem("q2", "question", "I want to ask what tests I need."),
      planItem("q3", "question", "I want to ask about sleep."),
      planItem("a1", "accommodation", "I need more time to answer."),
      planItem("q9", "question", "A disabled question.", false),
    ],
  };
  s.supportCard = {
    id: "c",
    topQuestionIds: ["q1", "q2"],
    items: [
      { id: "p1", text: "Please speak slowly.", source: "preset", enabled: true },
      { id: "p2", text: "Please ask me one question at a time.", source: "preset", enabled: false },
    ],
  };
  s.recap = {
    id: "r1",
    createdAt: "",
    isSample: true,
    isSavedFallback: false,
    mySpeaker: "B",
    transcript: [],
    items: [
      { section: "discussed", text: "We talked about headaches.", evidence: ["L1"] },
      { section: "instructions", text: "Rest and drink water.", evidence: ["L2"] },
      { section: "medications", text: "Ibuprofen: take with food.", evidence: ["L3"] },
      { section: "next_steps", text: "Book a follow-up visit.", evidence: ["L4"] },
    ],
    unconfirmed: [],
    planStatus: [
      { itemId: "q1", status: "asked_by_me", evidence: ["L1"] },
      { itemId: "q2", status: "asked_by_other", evidence: ["L2"] },
      { itemId: "q3", status: "not_asked", evidence: [] },
      { itemId: "a1", status: "unclear", evidence: [] },
      { itemId: "q9", status: "asked_by_me", evidence: [] },
      { itemId: "zzz", status: "asked_by_me", evidence: [] },
    ],
  };
  return s;
}
const sel = (over: Partial<ShareSelection>): ShareSelection => ({ ...EMPTY_SELECTION, ...over });

describe("buildShareText", () => {
  it("nothing selected gives an empty string", () => {
    expect(buildShareText(EMPTY_SELECTION, fullState())).toBe("");
    expect(buildShareText(EMPTY_SELECTION, defaultState())).toBe("");
  });

  it("selecting things that do not exist gives an empty string, not a lone footer", () => {
    expect(buildShareText(sel({ plan: true, supportCard: true, saidMyself: true }), defaultState())).toBe("");
  });

  it("plan only: concern and enabled items, no recap titles, no footer", () => {
    const text = buildShareText(sel({ plan: true }), fullState());
    expect(text).toContain("I keep getting headaches");
    expect(text).toContain("- I want to ask why I get these headaches.");
    expect(text).not.toContain("disabled question");
    for (const title of Object.values(RECAP_TITLES)) expect(text).not.toContain(title);
    expect(text).not.toContain(RECAP_FOOTER);
  });

  it("support card only prints the supported-by block", () => {
    expect(buildShareText(sel({ supportCard: true }), fullState())).toBe("How I like to be supported\n- Please speak slowly.");
  });

  it("one recap section on: only that section, and the text ends with the footer", () => {
    const text = buildShareText(sel({ recapSections: { medications: true } }), fullState());
    expect(text).toBe(`${RECAP_TITLES.medications}\n- Ibuprofen: take with food.\n\n${RECAP_FOOTER}`);
    expect(text.endsWith("Check anything important with your clinician.")).toBe(true);
    expect(text).not.toContain("headaches");
  });

  it("a recap section set to false does not count; a chosen but empty one still gets the footer", () => {
    expect(buildShareText(sel({ recapSections: { medications: false } }), fullState())).toBe("");
    const noItems = fullState();
    if (noItems.recap) noItems.recap.items = [];
    const text = buildShareText(sel({ recapSections: { discussed: true } }), noItems);
    expect(text).toContain(RECAP_TITLES.discussed);
    expect(text.endsWith(RECAP_FOOTER)).toBe(true);
  });

  it("recap sections come in a fixed order whatever the selection order", () => {
    const text = buildShareText(sel({ recapSections: { next_steps: true, discussed: true } }), fullState());
    expect(text.indexOf(RECAP_TITLES.discussed)).toBeLessThan(text.indexOf(RECAP_TITLES.next_steps));
  });

  it("saidMyself groups the enabled plan items by status", () => {
    const text = buildShareText(sel({ saidMyself: true }), fullState());
    expect(text).toBe(
      [
        "What I said myself",
        "Asked by me:",
        "- I want to ask why I get these headaches.",
        "Asked by someone else:",
        "- I want to ask what tests I need.",
        "Not asked:",
        "- I want to ask about sleep.",
        "Not clear:",
        "- I need more time to answer.",
      ].join("\n"),
    );
    expect(text).not.toContain(RECAP_FOOTER);
  });

  it("blocks are separated by a blank line in plan, support, recap, said-myself order", () => {
    const text = buildShareText(sel({ saidMyself: true, recapSections: { discussed: true }, supportCard: true, plan: true }), fullState());
    const at = (needle: string) => text.indexOf(needle);
    expect(at("My main concern")).toBeLessThan(at("How I like to be supported"));
    expect(at("How I like to be supported")).toBeLessThan(at(RECAP_TITLES.discussed));
    expect(at(RECAP_TITLES.discussed)).toBeLessThan(at("What I said myself"));
    expect(at("What I said myself")).toBeLessThan(at(RECAP_FOOTER));
    expect(text).not.toContain("\n\n\n");
  });
});

describe("buildKitText", () => {
  it("has the support card, the main concern and the top two questions", () => {
    const text = buildKitText(fullState());
    expect(text).toContain("- Please speak slowly.");
    expect(text).toContain("I keep getting headaches");
    expect(text).toContain("1. I want to ask why I get these headaches.");
    expect(text).toContain("2. I want to ask what tests I need.");
    expect(text).not.toContain("sleep");
  });

  it("is empty for a fresh state and works without a saved card", () => {
    expect(buildKitText(defaultState())).toBe("");
    const s = fullState();
    delete s.supportCard;
    expect(buildKitText(s)).toContain("I keep getting headaches");
  });
});

describe("shouldPlayFinishSound", () => {
  it("is off by default and on only when the setting is exactly true", () => {
    expect(shouldPlayFinishSound(defaultSettings())).toBe(false);
    expect(shouldPlayFinishSound({ ...defaultSettings(), finishSound: true })).toBe(true);
    expect(shouldPlayFinishSound({ ...defaultSettings(), finishSound: "yes" as never })).toBe(false);
  });
});
