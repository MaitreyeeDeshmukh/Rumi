/**
 * Stored and API types for Rumi. Frozen in Phase 0 (see 07-p0-roast-resolutions.md).
 * Everything the browser sends to the server is untrusted; these types describe shape, not trust.
 */
import type { VoiceKey } from '@/lib/voice/voices';
import type { FACT_KINDS, FOCUS_VALUES, HELP_LEVELS, PLAN_ITEM_KINDS, SPEAKERS } from './constants';

export type ThemeName = 'soft' | 'contrast' | 'low';
export type Focus = (typeof FOCUS_VALUES)[number];
export type HelpLevel = (typeof HELP_LEVELS)[number];
export type Speaker = (typeof SPEAKERS)[number];
export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number];
export type FactKind = (typeof FACT_KINDS)[number];

export interface Settings {
  name: string;
  companionName: string;
  theme: ThemeName;
  textScale: 1 | 1.15 | 1.3 | 1.5;
  reducedMotion: boolean;
  outputMode: 'read' | 'listen' | 'both';
  detail: 'short' | 'detailed';
  speechRate: number;
  /** Which Cartesia voice speaks (see lib/voice/voices.ts). One setting, read by the voice step, settings and profile setup. */
  voice: VoiceKey;
  finishSound: boolean;
  memoryOptIn: boolean;
}

export interface PlanItem {
  id: string;
  text: string;
  kind: PlanItemKind;
  source: 'user' | 'suggested';
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
  /** 'preset' items sync by id only. 'user' items never leave the device. */
  source: 'preset' | 'user';
  enabled: boolean;
}

export interface SupportCard {
  id: string;
  items: SupportItem[];
  /** At most two plan-question ids. */
  topQuestionIds: string[];
  /** Next number for a custom line id (`u<n>`). Only grows, so a removed line's id is never reused. */
  nextCustomId?: number;
}

export interface Turn {
  role: 'clinician' | 'me';
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
  /** Highest help level used per plan-item kind (not per positional id, ids repeat across plans). */
  helpLevelUsed: Partial<Record<PlanItemKind, HelpLevel>>;
}

export interface TranscriptLine {
  id: string;
  speaker: Speaker;
  text: string;
}

export type RecapSection = 'discussed' | 'instructions' | 'medications' | 'next_steps';

export interface RecapItem {
  section: RecapSection;
  text: string;
  /** Transcript line ids. Verified by code, never trusted from the model. */
  evidence: string[];
}

export type PlanStatus = 'asked_by_me' | 'asked_by_other' | 'not_asked' | 'unclear';

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
  /** Fixed-template lines only ("I could not confirm this: ..."). The model never writes these. */
  unconfirmed: string[];
  planStatus: PlanStatusEntry[];
}

/**
 * Persona fact: a short choice the user made. It has NO free text. The sentence shown to the user
 * and put in a prompt is derived by one pure function from (kind, key, level) and fixed tables.
 * Custom support items are not persona facts and never leave the device.
 */
export interface PersonaFact {
  id: string;
  kind: FactKind;
  key: string;
  level?: HelpLevel;
  createdAt: string;
}

export interface Persona {
  facts: PersonaFact[];
  recoveryCode?: string;
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

export type ApiErrorCode = 'bad_input' | 'too_large' | 'forbidden' | 'ai_invalid' | 'ai_unavailable' | 'rate_limited';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; crisis: true }
  | { ok: false; error: { code: ApiErrorCode; message: string } };
