import { describe, expect, it } from "vitest";
import { HELP_KINDS, helpLevelWord, helpTrend } from "@/features/home/helpLevel";
import { nextStartLevel } from "@/features/practice/nextStartLevel";
import { startLevelFor } from "@/features/adapters/startLevelFor";
import { summarizeSession } from "@/features/practice/summarizeSession";
import { isCrisis } from "@/lib/crisis";
import { DEMO_PLAN } from "@/fixtures/demoPlan";
import type { PracticeSession, RumiState } from "@/features/shared/types";

describe("helpLevelWord", () => {
  it("names each level in words", () => {
    expect([0, 1, 2, 3].map((l) => helpLevelWord(l as 0 | 1 | 2 | 3))).toEqual([
      "No help",
      "A hint",
      "A sentence with blanks",
      "A full sentence",
    ]);
  });
});

describe("HELP_KINDS", () => {
  it("has the three plan item kinds with their labels", () => {
    expect(HELP_KINDS).toEqual([
      { kind: "concern", label: "Describing what is wrong" },
      { kind: "question", label: "Asking your questions" },
      { kind: "accommodation", label: "Asking for what you need" },
    ]);
  });
});

describe("helpTrend", () => {
  it("says nothing when the level stayed the same", () => {
    expect(helpTrend(2, 2)).toBeNull();
  });
  it("names both levels when it changed", () => {
    expect(helpTrend(2, 1)).toBe("Last time you needed a sentence with blanks. This time you needed a hint.");
    expect(helpTrend(0, 3)).toBe("Last time you needed no help. This time you needed a full sentence.");
  });
});

const session = (over: Partial<PracticeSession>): PracticeSession => ({
  id: "s",
  planId: DEMO_PLAN.id,
  startedAt: "2026-11-02T10:00:00.000Z",
  focus: "whole",
  turns: [],
  coveredItemIds: [],
  helpCount: 0,
  helpLevelUsed: {},
  ...over,
});
const stateWith = (sessions: PracticeSession[]): RumiState =>
  ({ version: 1, settings: {}, plan: DEMO_PLAN, sessions, persona: { facts: [] } }) as unknown as RumiState;

describe("nextStartLevel and startLevelFor (shim)", () => {
  it("follow the lane rules", () => {
    expect(nextStartLevel([])).toBe(1);
    expect(nextStartLevel([{ level: 0, stuck: false }])).toBe(0);
    expect(nextStartLevel([{ level: 3, stuck: false }])).toBe(2);
    expect(nextStartLevel([{ level: 2, stuck: true }, { level: 2, stuck: true }])).toBe(1);
  });
  it("startLevelFor reads the levels used for one kind", () => {
    expect(startLevelFor(stateWith([]), "question")).toBe(1);
    expect(startLevelFor(stateWith([session({ helpLevelUsed: { question: 3 } })]), "question")).toBe(2);
    expect(startLevelFor(stateWith([session({ helpLevelUsed: { question: 0 } })]), "question")).toBe(0);
  });
});

describe("summarizeSession (shim)", () => {
  it("counts lines said alone and with help", () => {
    const ids = DEMO_PLAN.items.map((i) => i.id);
    const s = summarizeSession(session({ coveredItemIds: ids.slice(0, 3), helpLevelUsed: { question: 2 } }), DEMO_PLAN);
    // Help is recorded per kind of line: q2 and q3 are questions, q1 is a concern.
    expect(s).toMatchObject({ saidMyself: 1, saidWithHelp: 2, total: 4, focusLabel: "The whole visit" });
  });
});

describe("isCrisis (shim)", () => {
  it("catches clear phrases and leaves ordinary text alone", () => {
    expect(isCrisis("I want to hurt myself")).toBe(true);
    expect(isCrisis("I keep getting headaches")).toBe(false);
  });
});
