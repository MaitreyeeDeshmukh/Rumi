import { describe, expect, it } from "vitest";
import { buildSupportCardText, newSupportCard, supportSection } from "@/features/support/card";
import { SUPPORT_PRESETS } from "@/features/support/presets";
import type { PersonaFact, SupportCard, VisitPlan } from "@/features/shared/types";

const fact = (kind: PersonaFact["kind"], key: string): PersonaFact => ({ id: `${kind}:${key}`, kind, key, createdAt: "" });
const plan = (over: Partial<VisitPlan> = {}): VisitPlan => ({
  id: "plan-1",
  title: "Visit",
  createdAt: "",
  mainConcern: "I keep getting headaches",
  symptomsInMyWords: [],
  items: [
    { id: "q1", text: "I want to ask why I get these headaches.", kind: "question", source: "user", enabled: true },
    { id: "a1", text: "I need more time to answer.", kind: "accommodation", source: "user", enabled: true },
    { id: "q2", text: "I want to ask what tests I need.", kind: "question", source: "user", enabled: true },
    { id: "q3", text: "I want to ask about sleep.", kind: "question", source: "user", enabled: true },
    { id: "q4", text: "Disabled question.", kind: "question", source: "user", enabled: false },
  ],
  ...over,
});
const card = (items: SupportCard["items"], topQuestionIds: string[] = []): SupportCard => ({ id: "c1", items, topQuestionIds });
const item = (id: string, enabled: boolean, text = "t"): SupportCard["items"][number] => ({ id, text, source: "preset", enabled });

describe("newSupportCard", () => {
  it("has one preset item per preset, enabled only for the chosen ones", () => {
    const c = newSupportCard(undefined, { facts: [fact("support_pref", "p2")] });
    expect(c.items.map((i) => i.id)).toEqual(SUPPORT_PRESETS.map((p) => p.id));
    expect(c.items.every((i) => i.source === "preset")).toBe(true);
    expect(c.items.filter((i) => i.enabled).map((i) => i.id)).toEqual(["p2"]);
    expect(c.items.find((i) => i.id === "p2")?.text).toBe("Please ask me one question at a time.");
  });

  it("a pacing fact or a fact of another kind does not enable a preset", () => {
    const c = newSupportCard(undefined, { facts: [fact("pacing", "p1"), fact("help_level", "p3")] });
    expect(c.items.some((i) => i.enabled)).toBe(false);
  });

  it("picks the first two enabled question items of the plan", () => {
    expect(newSupportCard(plan(), { facts: [] }).topQuestionIds).toEqual(["q1", "q2"]);
    const noFirst = plan();
    noFirst.items[0].enabled = false;
    expect(newSupportCard(noFirst, { facts: [] }).topQuestionIds).toEqual(["q2", "q3"]);
    expect(newSupportCard(undefined, { facts: [] }).topQuestionIds).toEqual([]);
  });
});

describe("buildSupportCardText", () => {
  it("lists only enabled items and prints the three blocks in order", () => {
    const text = buildSupportCardText(card([item("p1", true), item("p2", false), item("p5", true)], ["q1"]), plan());
    expect(text).toBe(
      [
        "How I like to be supported",
        "- Please speak slowly.",
        "- I may need extra time to answer.",
        "",
        "My main concern",
        "I keep getting headaches",
        "",
        "My top questions",
        "1. I want to ask why I get these headaches.",
      ].join("\n"),
    );
  });

  it("lists exactly the enabled items of three with one disabled", () => {
    const text = buildSupportCardText(card([item("p1", true), item("p2", false), item("p3", true)]), undefined);
    expect(text.split("\n").filter((l) => l.startsWith("- "))).toEqual(["- Please speak slowly.", "- Please write down instructions for me."]);
  });

  it("prints at most two top questions even when three ids are stored", () => {
    const text = buildSupportCardText(card([item("p1", true)], ["q1", "q2", "q3"]), plan());
    expect(text).toContain("1. I want to ask why I get these headaches.");
    expect(text).toContain("2. I want to ask what tests I need.");
    expect(text).not.toContain("3.");
    expect(text).not.toContain("sleep");
  });

  it("skips unknown and disabled question ids", () => {
    const text = buildSupportCardText(card([], ["nope", "q4", "q3"]), plan({ mainConcern: "" }));
    expect(text).toBe(["My top questions", "1. I want to ask about sleep."].join("\n"));
  });

  it("omits empty blocks and returns an empty string when nothing remains", () => {
    expect(buildSupportCardText(card([item("p1", false)]), undefined)).toBe("");
    expect(buildSupportCardText(card([]), plan({ mainConcern: "   ", items: [] }))).toBe("");
    expect(buildSupportCardText(card([item("p1", true)]), undefined)).toBe("How I like to be supported\n- Please speak slowly.");
  });

  it("is plain text: no markdown markers", () => {
    const text = buildSupportCardText(card([item("p1", true)], ["q1"]), plan());
    expect(text).not.toMatch(/[*#_`>]/);
  });

  it("uses the canonical preset text, not the stored text", () => {
    expect(supportSection(card([item("p1", true, "I have bipolar disorder")]))).toBe("How I like to be supported\n- Please speak slowly.");
  });

  it("keeps a user item's own text", () => {
    const c = card([{ id: "u1", text: "Please dim the lights.", source: "user", enabled: true }]);
    expect(supportSection(c)).toBe("How I like to be supported\n- Please dim the lights.");
  });
});
