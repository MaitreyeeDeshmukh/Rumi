import { describe, expect, it } from "vitest";
import { factId, factsFromState, helpHistoryFor, toWireFacts } from "@/features/memory/persona";
import { factText } from "@/features/memory/factText";
import { FactsRequest } from "@/features/shared/schemas";
import { defaultState } from "@/lib/storage";
import type { PracticeSession, RumiState, SupportItem } from "@/features/shared/types";

const NOW = "2026-11-05T10:00:00.000Z";
const preset = (id: string, enabled = true, text = "whatever"): SupportItem => ({ id, text, source: "preset", enabled });
const withCard = (items: SupportItem[]): RumiState => ({ ...defaultState(), supportCard: { id: "c1", items, topQuestionIds: [] } });
const session = (id: string, helpLevelUsed: PracticeSession["helpLevelUsed"]): PracticeSession => ({
  id,
  planId: "plan-1",
  startedAt: NOW,
  focus: "whole",
  turns: [],
  coveredItemIds: [],
  helpCount: 0,
  helpLevelUsed,
});

describe("factsFromState", () => {
  it("p2 and p5 on gives support_pref and pacing facts, in card order", () => {
    const facts = factsFromState(withCard([preset("p2"), preset("p1", false), preset("p5")]), NOW);
    expect(facts.map((f) => f.id)).toEqual(["support_pref:p2", "pacing:one_question", "support_pref:p5", "pacing:extra_time"]);
    expect(facts.every((f) => f.createdAt === NOW)).toBe(true);
  });

  it("a card with repeated ids gives one fact per id", () => {
    const facts = factsFromState(withCard([preset("p1"), preset("p1"), preset("p2"), preset("p2")]), NOW);
    expect(facts.map((f) => f.id)).toEqual(["support_pref:p1", "support_pref:p2", "pacing:one_question"]);
  });

  it("a custom support item never becomes a fact", () => {
    const s = withCard([
      { id: "u1", text: "I have bipolar disorder and take lithium.", source: "user", enabled: true },
      { id: "p1", text: "I have bipolar disorder and take lithium.", source: "user", enabled: true },
    ]);
    const facts = factsFromState(s, NOW);
    expect(facts).toEqual([]);
    expect(JSON.stringify(facts)).not.toMatch(/bipolar|lithium/);
  });

  it("tampered preset text in storage cannot change what is synced: only the id counts", () => {
    const s = withCard([preset("p1", true, "I have bipolar disorder and take lithium.")]);
    const facts = factsFromState(s, NOW);
    expect(facts).toHaveLength(1);
    expect(JSON.stringify(facts)).not.toMatch(/bipolar|lithium/);
    expect(factText(facts[0].kind, facts[0].key, facts[0].level)).toBe("Please speak slowly.");
  });

  it("unknown or hostile preset ids are ignored", () => {
    const s = withCard([preset("p9"), preset("constructor"), preset("__proto__"), preset("toString"), preset("")]);
    expect(factsFromState(s, NOW)).toEqual([]);
  });

  it("help-level facts come from the last session per kind", () => {
    const s = { ...defaultState(), sessions: [session("s1", { question: 3 }), session("s2", { question: 2, concern: 0 })] };
    const facts = factsFromState(s, NOW);
    expect(facts.map((f) => [f.id, f.level])).toEqual([
      ["help_level:concern", 0],
      ["help_level:question", 2],
    ]);
    expect(factText("help_level", "question", 2)).toBe("When I practice asking my questions, I needed a sentence with blanks last time.");
  });

  it("keeps the old createdAt for a fact that was already there", () => {
    const s = withCard([preset("p1")]);
    s.persona.facts = [{ id: "support_pref:p1", kind: "support_pref", key: "p1", createdAt: "earlier" }];
    expect(factsFromState(s, NOW)[0].createdAt).toBe("earlier");
  });

  it("privacy: facts never contain plan text, symptoms or what the person said, for hostile plans", () => {
    const secrets = ["HIV test", "sertraline", "panic attacks", "my landlord Karen", "Dr. Okafor"];
    const s = withCard([preset("p1"), preset("p2"), preset("p4")]);
    s.settings.name = "Priya Raman";
    s.plan = {
      id: "plan-1",
      title: "Dr. Okafor visit",
      createdAt: NOW,
      mainConcern: "I want an HIV test and I take sertraline",
      symptomsInMyWords: ["panic attacks at night", "my landlord Karen scares me"],
      items: [
        { id: "q1", text: "Can I stop sertraline? I get panic attacks.", kind: "question", source: "user", enabled: true },
        { id: "q2", text: "Please do an HIV test for me.", kind: "accommodation", source: "user", enabled: true },
      ],
    };
    s.sessions = [
      { ...session("s1", { question: 2, accommodation: 3, concern: 1 }), turns: [{ role: "me", text: "I have panic attacks and take sertraline" }] },
    ];
    const json = JSON.stringify(factsFromState(s, NOW)) + JSON.stringify(toWireFacts(factsFromState(s, NOW)));
    for (const secret of secrets) expect(json).not.toContain(secret);
    expect(json).not.toContain("Priya");
    expect(json).not.toMatch(/sertraline|HIV|panic|Karen|Okafor/i);
  });
});

describe("helpHistoryFor", () => {
  it("returns one entry per session that used the kind, oldest first, stuck at level 3", () => {
    const s = { ...defaultState(), sessions: [session("s1", { question: 3 }), session("s2", { concern: 1 }), session("s3", { question: 1 })] };
    expect(helpHistoryFor(s, "question")).toEqual([
      { level: 3, stuck: true },
      { level: 1, stuck: false },
    ]);
    expect(helpHistoryFor(s, "accommodation")).toEqual([]);
  });

  it("reads own keys only", () => {
    const s = { ...defaultState(), sessions: [session("s1", {})] };
    Object.defineProperty(Object.prototype, "question", { value: 2, configurable: true });
    try {
      expect(helpHistoryFor(s, "question")).toEqual([]);
      expect(helpHistoryFor(s, "constructor" as never)).toEqual([]);
    } finally {
      Reflect.deleteProperty(Object.prototype, "question");
    }
  });
});

describe("toWireFacts", () => {
  it("drops ids and dates and passes the strict wire schema", () => {
    const facts = factsFromState(withCard([preset("p2")]), NOW);
    const wire = toWireFacts(facts);
    expect(wire).toEqual([
      { kind: "support_pref", key: "p2" },
      { kind: "pacing", key: "one_question" },
    ]);
    expect(FactsRequest.safeParse({ facts: wire }).success).toBe(true);
    const withLevel = toWireFacts([{ id: "help_level:question", kind: "help_level", key: "question", level: 2, createdAt: NOW }]);
    expect(withLevel).toEqual([{ kind: "help_level", key: "question", level: 2 }]);
    expect(FactsRequest.safeParse({ facts: withLevel }).success).toBe(true);
    expect(factId("pacing", "extra_time")).toBe("pacing:extra_time");
  });
});
