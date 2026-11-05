import { describe, expect, it } from "vitest";
import { factsFromState, helpHistoryFor, mergeRemote, pendingRemovals, toSyncFacts, toWireRemovals } from "@/features/memory/persona";
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
    s.persona.facts = [{ id: "support_pref:p1", kind: "support_pref", key: "p1", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" }];
    const [f] = factsFromState(s, NOW);
    expect(f.createdAt).toBe("2026-10-01T00:00:00.000Z");
    expect(f.updatedAt).toBe("2026-10-02T00:00:00.000Z");
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
    const json = JSON.stringify(factsFromState(s, NOW)) + JSON.stringify(toSyncFacts(factsFromState(s, NOW)));
    for (const secret of secrets) expect(json).not.toContain(secret);
    expect(json).not.toContain("Priya");
    expect(json).not.toMatch(/sertraline|HIV|panic|Karen|Okafor/i);
  });
});

describe("helpHistoryFor", () => {
  it("returns one entry per session that used the kind, oldest first, stuck at level 3", () => {
    const s = { ...defaultState(), sessions: [session("s1", { question: 3 }), session("s2", { concern: 1 }), session("s3", { question: 1 })] };
    expect(helpHistoryFor(s, "question")).toEqual([
      { level: 3, stuck: true, at: NOW },
      { level: 1, stuck: false, at: NOW },
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

describe("updatedAt", () => {
  it("a stated fact keeps its time across calls; a help level carries the time of its practice", () => {
    const first = factsFromState(withCard([preset("p1")]), "2026-11-05T10:00:00.000Z");
    const again = factsFromState({ ...withCard([preset("p1")]), persona: { facts: first } }, "2026-11-05T12:00:00.000Z");
    expect(again[0].updatedAt).toBe("2026-11-05T10:00:00.000Z");
    const s = { ...defaultState(), sessions: [{ ...session("s1", { question: 2 }), startedAt: "2026-11-04T08:00:00+02:00" }] };
    const [h] = factsFromState(s, NOW);
    expect(h.updatedAt).toBe("2026-11-04T06:00:00.000Z");
  });

  it("a changed level gets a new time; an unreadable stored time is replaced, never sent", () => {
    const old = { id: "help_level:question", kind: "help_level" as const, key: "question", level: 1 as const, createdAt: "x", updatedAt: "garbage" };
    const s = { ...defaultState(), persona: { facts: [old] }, sessions: [{ ...session("s1", { question: 2 }), startedAt: "not a time" }] };
    expect(factsFromState(s, NOW)[0].updatedAt).toBe(NOW);
    const same = { ...defaultState(), persona: { facts: [{ ...old, level: 2 as const }] }, sessions: [{ ...session("s1", { question: 2 }), startedAt: "not a time" }] };
    expect(factsFromState(same, NOW)[0].updatedAt).toBe(NOW);
  });
});

describe("toSyncFacts and toWireRemovals", () => {
  it("send kind, key, level and the change time, and pass the strict request schema", () => {
    const facts = factsFromState(withCard([preset("p2")]), NOW);
    const wire = toSyncFacts(facts);
    expect(wire).toEqual([
      { kind: "support_pref", key: "p2", client_updated_at: NOW },
      { kind: "pacing", key: "one_question", client_updated_at: NOW },
    ]);
    expect(FactsRequest.safeParse({ facts: wire }).success).toBe(true);
    const withLevel = toSyncFacts([{ id: "help_level:question", kind: "help_level", key: "question", level: 2, createdAt: NOW, updatedAt: NOW }]);
    expect(withLevel).toEqual([{ kind: "help_level", key: "question", level: 2, client_updated_at: NOW }]);
    expect(FactsRequest.safeParse({ facts: withLevel }).success).toBe(true);
  });

  it("removals carry stated kinds only", () => {
    expect(toWireRemovals([{ id: "support_pref:p1", at: NOW }, { id: "help_level:question", at: NOW }, { id: "pacing:extra_time", at: NOW }])).toEqual([
      { kind: "support_pref", key: "p1", client_updated_at: NOW },
      { kind: "pacing", key: "extra_time", client_updated_at: NOW },
    ]);
  });
});

describe("pendingRemovals", () => {
  const f = (kind: "support_pref" | "pacing" | "help_level", key: string) => ({ id: `${kind}:${key}`, kind, key, createdAt: NOW, updatedAt: NOW });
  const LATER = "2026-11-06T00:00:00.000Z";

  it("a stated fact that is gone while a support card exists becomes a removal at that time", () => {
    const before = { facts: [f("support_pref", "p1"), f("support_pref", "p2")] };
    expect(pendingRemovals(before, [f("support_pref", "p2")], true, LATER)).toEqual([{ id: "support_pref:p1", at: LATER }]);
  });

  it("without a support card nothing is removed: a new device cannot delete what another device saved", () => {
    expect(pendingRemovals({ facts: [f("support_pref", "p1")] }, [], false, LATER)).toEqual([]);
  });

  it("help levels are never removed one by one", () => {
    expect(pendingRemovals({ facts: [f("help_level", "question")] }, [], true, LATER)).toEqual([]);
  });

  it("a fact that came back is no longer pending; an older pending removal keeps its time", () => {
    const before = { facts: [], removed: [{ id: "support_pref:p1", at: NOW }, { id: "support_pref:p2", at: NOW }] };
    expect(pendingRemovals(before, [f("support_pref", "p1")], true, LATER)).toEqual([{ id: "support_pref:p2", at: NOW }]);
  });
});

describe("mergeRemote", () => {
  const OLD = "2026-11-01T00:00:00.000Z";
  const NEW = "2026-11-05T00:00:00.000Z";
  const local = (updatedAt: string, level?: 0 | 1 | 2 | 3): RumiState => ({
    ...defaultState(),
    persona: { facts: [{ id: "help_level:question", kind: "help_level", key: "question", level: level ?? 1, createdAt: OLD, updatedAt }] },
  });

  it("a newer stored copy replaces the local one (a stale device does not win)", () => {
    const merged = mergeRemote(local(OLD), [{ kind: "help_level", key: "question", level: 3, client_updated_at: NEW }]);
    expect(merged).toEqual([{ id: "help_level:question", kind: "help_level", key: "question", level: 3, createdAt: OLD, updatedAt: NEW }]);
  });

  it("an older or equal stored copy changes nothing", () => {
    const s = local(NEW);
    expect(mergeRemote(s, [{ kind: "help_level", key: "question", level: 3, client_updated_at: OLD }])).toEqual(s.persona.facts);
    expect(mergeRemote(s, [{ kind: "help_level", key: "question", level: 3, client_updated_at: NEW }])).toEqual(s.persona.facts);
  });

  it("a local fact with an unreadable time loses to any stored copy", () => {
    const merged = mergeRemote(local("garbage"), [{ kind: "help_level", key: "question", level: 2, client_updated_at: OLD }]);
    expect(merged[0].level).toBe(2);
  });

  it("a new device (no support card) takes what is stored", () => {
    const merged = mergeRemote(defaultState(), [{ kind: "support_pref", key: "p1", client_updated_at: NEW }]);
    expect(merged.map((m) => m.id)).toEqual(["support_pref:p1"]);
  });

  it("a device that has a support card does not take back a stated fact it does not have", () => {
    const s = withCard([preset("p2")]);
    expect(mergeRemote(s, [{ kind: "support_pref", key: "p1", client_updated_at: NEW }])).toEqual([]);
  });

  it("a fact pending removal is not taken back even without a card", () => {
    const s = { ...defaultState(), persona: { facts: [], removed: [{ id: "support_pref:p1", at: NEW }] } };
    expect(mergeRemote(s, [{ kind: "support_pref", key: "p1", client_updated_at: OLD }])).toEqual([]);
  });
});
