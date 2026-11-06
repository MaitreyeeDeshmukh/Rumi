import { describe, expect, it } from "vitest";
import { DEMO_PLAN } from "@/fixtures/demoPlan";
import {
  addCustomItem,
  buildKitText,
  buildSupportCardText,
  newSupportCard,
  shouldPlayFinishSound,
} from "@/features/adapters/getReadyKit";
import type { RumiState, SupportCard } from "@/features/shared/types";

const fact = (key: string) => ({ id: `support_pref:${key}`, kind: "support_pref" as const, key, createdAt: "", updatedAt: "" });

describe("support card builders", () => {
  it("newSupportCard turns on only the presets the persona holds and picks two questions", () => {
    const card = newSupportCard(DEMO_PLAN, { facts: [fact("p2")] });
    expect(card.items).toHaveLength(6);
    expect(card.items.filter((i) => i.enabled).map((i) => i.id)).toEqual(["p2"]);
    expect(card.topQuestionIds).toEqual(["q2", "q3"]);
  });

  it("buildSupportCardText lists only enabled lines, the concern and at most two questions", () => {
    const card: SupportCard = {
      id: "c",
      items: [
        { id: "p1", text: "Please speak slowly.", source: "preset", enabled: true },
        { id: "p2", text: "Off line.", source: "preset", enabled: false },
        { id: "u1", text: "I may need extra time.", source: "user", enabled: true },
      ],
      topQuestionIds: ["q2", "q3", "q4"],
    };
    const text = buildSupportCardText(card, DEMO_PLAN);
    expect(text).toContain("- Please speak slowly.\n- I may need extra time.");
    expect(text).not.toContain("Off line.");
    expect(text).toContain("My main concern\nI keep getting headaches");
    expect(text).toContain("1. I want to ask why I get these headaches.\n2. I want to ask what I should do next.");
    expect(text).not.toContain("instructions in writing");
  });

  it("returns an empty string when nothing remains", () => {
    expect(buildSupportCardText({ id: "c", items: [], topQuestionIds: [] }, undefined)).toBe("");
  });

  it("addCustomItem trims, rejects blank and long lines, and appends a user item", () => {
    const card = newSupportCard(undefined, { facts: [] });
    expect(addCustomItem(card, "   ").error).toBeTruthy();
    const long = Array.from({ length: 16 }, () => "word").join(" ");
    const tooLong = addCustomItem(card, long);
    expect(tooLong.error).toBeTruthy();
    expect(tooLong.card.items).toHaveLength(6);
    const ok = addCustomItem(card, "  I need a quiet room.  ");
    expect(ok.error).toBeUndefined();
    expect(ok.card.items.at(-1)).toMatchObject({ id: "u1", text: "I need a quiet room.", source: "user", enabled: true });
  });

  it("buildKitText joins the enabled plan lines and the card, and is the card and concern, and has no support lines without a card", () => {
    const supportCard = newSupportCard(DEMO_PLAN, { facts: [fact("p1")] });
    const state = { plan: DEMO_PLAN, supportCard } as unknown as RumiState;
    const text = buildKitText(state);
    // The kit is the support card, the main concern and the top two questions: the things to take into the room.
    expect(text.startsWith("How I like to be supported\n- Please speak slowly.")).toBe(true);
    expect(text).toContain("My main concern\nI keep getting headaches");
    expect(buildKitText({ plan: DEMO_PLAN, persona: { facts: [] } } as unknown as RumiState)).not.toContain("How I like to be supported");
  });

  it("shouldPlayFinishSound follows the setting", () => {
    expect(shouldPlayFinishSound({ finishSound: true } as RumiState["settings"])).toBe(true);
    expect(shouldPlayFinishSound({ finishSound: false } as RumiState["settings"])).toBe(false);
  });
});
