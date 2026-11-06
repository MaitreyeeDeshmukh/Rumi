import type { Page } from "@playwright/test";

// Test data for `rumi.v1` (field names from 00-shared-contract.md section 4). Made up; no real person.
export type StateKind = "empty" | "plan" | "planCard" | "practiced" | "recap";

const SETTINGS = {
  name: "",
  companionName: "Rumi",
  theme: "soft",
  textScale: 1,
  reducedMotion: false,
  outputMode: "both",
  detail: "short",
  speechRate: 1,
  finishSound: false,
  memoryOptIn: false,
  onboarded: true,
};

const item = (id: string, kind: string, text: string, enabled = true) => ({ id, text, kind, source: "user", enabled });

const PLAN = {
  id: "plan-1",
  title: "Headaches",
  createdAt: "2026-11-01T10:00:00.000Z",
  mainConcern: "Headaches for two weeks",
  symptomsInMyWords: ["My head hurts when I read."],
  items: [
    item("c1", "concern", "I have had headaches for two weeks."),
    item("q1", "question", "What could cause this?"),
    item("q2", "question", "Do I need a test?"),
    item("a1", "accommodation", "Please speak slowly."),
    item("a2", "accommodation", "Please write the steps down.", false),
  ],
};

const CARD = {
  id: "card-1",
  items: [{ id: "p1", text: "Please speak slowly.", source: "preset", enabled: true }],
  topQuestionIds: ["q1"],
};

// Two things said alone (c1, q1) and one with help (a1): the plan has 4 enabled lines, so "2 of 4".
const SESSION = {
  id: "s1",
  planId: "plan-1",
  startedAt: "2026-11-02T10:00:00.000Z",
  focus: "whole",
  turns: [],
  coveredItemIds: ["c1", "q1", "a1"],
  helpCount: 1,
  helpLevelUsed: { c1: 0, q1: 0, a1: 2 },
};

const RECAP = {
  id: "r1",
  planId: "plan-1",
  createdAt: "2026-11-03T10:00:00.000Z",
  isSample: true,
  isSavedFallback: false,
  mySpeaker: "B",
  transcript: [{ id: "t1", speaker: "A", text: "How long have you had the headaches?" }],
  items: [{ section: "discussed", text: "Headaches for two weeks.", evidence: ["t1"] }],
  unconfirmed: [],
  planStatus: [],
};

/** JSON text of a valid `rumi.v1`. `settings` overrides single settings (for example a name). */
export function buildState(kind: StateKind, settings: Record<string, unknown> = {}): string {
  const state: Record<string, unknown> = {
    version: 1,
    settings: { ...SETTINGS, ...settings },
    sessions: [],
    persona: { facts: [] },
  };
  if (kind !== "empty") state.plan = PLAN;
  if (kind !== "empty" && kind !== "plan") state.supportCard = CARD;
  if (kind === "practiced" || kind === "recap") state.sessions = [SESSION];
  if (kind === "recap") state.recap = RECAP;
  return JSON.stringify(state);
}

/** Before the page loads, writes the state if the key is absent (a reload keeps what the user changed). */
export async function seed(page: Page, kind: StateKind, settings: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((json) => {
    try {
      if (localStorage.getItem("rumi.v1") === null) localStorage.setItem("rumi.v1", json);
    } catch {
      // blocked storage: nothing to seed
    }
  }, buildState(kind, settings));
}
