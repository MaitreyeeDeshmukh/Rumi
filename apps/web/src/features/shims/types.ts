// swap when the lane merges: delete this file and import from src/features/shared/types.ts
// (copied from 00-shared-contract.md section 4.1)
export type ThemeName = "soft" | "contrast" | "low";
export type Focus = "problem" | "questions" | "needs" | "next_steps" | "whole";
export type HelpLevel = 0 | 1 | 2 | 3;
export type Speaker = "A" | "B" | "C" | "D";

export interface Settings {
  name: string;
  companionName: string;
  theme: ThemeName;
  textScale: 1 | 1.15 | 1.3 | 1.5;
  reducedMotion: boolean;
  outputMode: "read" | "listen" | "both";
  detail: "short" | "detailed";
  speechRate: number;
  finishSound: boolean;
  memoryOptIn: boolean;
  /** Not in the contract: the shim keeps it so Open Rumi knows whether setup is done. */
  onboarded: boolean;
}
export interface PlanItem {
  id: string;
  text: string;
  kind: "concern" | "question" | "accommodation";
  source: "user" | "suggested";
  enabled: boolean;
}
export interface VisitPlan {
  id: string;
  title: string;
  createdAt: string;
  mainConcern: string;
  symptomsInMyWords: string[];
  items: PlanItem[];
}
export interface SupportItem {
  id: string;
  text: string;
  source: "preset" | "user";
  enabled: boolean;
}
export interface SupportCard {
  id: string;
  items: SupportItem[];
  topQuestionIds: string[];
}
export interface Turn {
  role: "clinician" | "me";
  text: string;
  usedHelp?: boolean;
}
export interface PracticeSession {
  id: string;
  planId: string;
  startedAt: string;
  focus: Focus;
  readyBefore?: 1 | 2 | 3 | 4 | 5;
  readyAfter?: 1 | 2 | 3 | 4 | 5;
  turns: Turn[];
  coveredItemIds: string[];
  helpCount: number;
  helpLevelUsed: Record<string, HelpLevel>;
}
export interface TranscriptLine {
  id: string;
  speaker: Speaker;
  text: string;
}
export type RecapSection = "discussed" | "instructions" | "medications" | "next_steps";
export interface RecapItem {
  section: RecapSection;
  text: string;
  evidence: string[];
}
export type PlanStatus = "asked_by_me" | "asked_by_other" | "not_asked" | "unclear";
export interface PlanStatusEntry {
  itemId: string;
  status: PlanStatus;
  evidence: string[];
}
export interface Recap {
  id: string;
  planId?: string;
  createdAt: string;
  isSample: true;
  isSavedFallback: boolean;
  mySpeaker: Speaker;
  transcript: TranscriptLine[];
  items: RecapItem[];
  unconfirmed: string[];
  planStatus: PlanStatusEntry[];
}
export type FactKind = "support_pref" | "pacing" | "help_level" | "focus_pref";
export interface PersonaFact {
  id: string;
  kind: FactKind;
  key: string;
  text: string;
  level?: HelpLevel;
  createdAt: string;
}
export interface Persona {
  facts: PersonaFact[];
}
export interface RumiState {
  version: 1;
  settings: Settings;
  plan?: VisitPlan;
  supportCard?: SupportCard;
  sessions: PracticeSession[];
  recap?: Recap;
  persona: Persona;
}
export type ApiErrorCode = "bad_input" | "too_large" | "forbidden" | "ai_invalid" | "ai_unavailable" | "rate_limited";
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; crisis: true }
  | { ok: false; error: { code: ApiErrorCode; message: string } };
