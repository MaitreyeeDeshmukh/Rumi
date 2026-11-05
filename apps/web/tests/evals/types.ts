/**
 * Shared types for the eval system. Nothing in tests/evals imports the harness or its regex lists:
 * the scorers are written separately so a bug in the guards cannot also hide in the measurement.
 */
import type { TaskName } from '../../src/features/shared/task';

export type { TaskName };
export type Arm = 'harness' | 'baseline';
export type RunMode = 'live' | 'dry';
export type Suite = 'plan' | 'practice' | 'sayit' | 'recap' | 'crisis' | 'redteam' | 'scenario';

/** D31: every recorded case is exactly one of these. */
export const CASE_CLASSES = ['model_ok', 'retry_ok', 'fallback', 'crisis', 'mock', 'error', 'empty'] as const;
export type CaseClass = (typeof CASE_CLASSES)[number];

export interface CallUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/** What one request produced, as seen from outside. The RunFn (live: runTask, dry: a replay) fills this in. */
export interface Observation {
  status: number;
  degraded: boolean;
  /** Provider calls made for this request (0 when crisis or fallback skipped the model). */
  attempts: number;
  modelUsed: string | null;
  body: unknown;
  /** 'mock' means the MOCK_AI shortcut answered, which is never a measurement. */
  mode: 'live' | 'dry' | 'mock';
  tier?: 'quality' | 'fast' | null;
  latencyMs?: number;
  /** Every provider call including failed attempts, for the cost-per-session number. */
  calls?: CallUsage[];
  promptVersion?: string;
  /** Response headers, scanned for leaks (E-7). */
  headers?: Record<string, string>;
  /** Harness arm only: the adapter reports whether the EVAL_MODE canary was really in the prompt (else rt03 is vacuous). */
  canaryInPrompt?: boolean;
}

/** Structured assertions. `human_check` is never scored by code: it goes to the human sample. */
export type Hold =
  | { type: 'valid_reply' }
  | { type: 'not_crisis' }
  | { type: 'no_links' }
  | { type: 'no_advice' }
  | { type: 'no_invented_numbers' }
  | { type: 'max_chars'; max: number }
  | { type: 'refusal_intent' }
  | { type: 'contains_any'; anyOf: string[] }
  | { type: 'no_question_marks' }
  | { type: 'field_equals'; path: string; value: string | number | boolean }
  | { type: 'min_items'; path: string; min: number }
  | { type: 'plan_status'; itemId: string; status: string }
  | { type: 'plan_status_not_all'; status: string }
  | { type: 'no_item_cites'; lineIds: string[] }
  | { type: 'section_count'; section: string; min?: number; max?: number }
  | { type: 'every_item_cites_input_line' }
  | { type: 'no_text_matches'; pattern: string }
  | { type: 'english_only' }
  | { type: 'max_items'; path: string; max: number }
  | { type: 'drug_not_recommended'; drug: string }
  | { type: 'items_supported_by_cited_lines' }
  | { type: 'canary_was_in_prompt' }
  | { type: 'human_check'; note: string };

export interface ProbeStep {
  me: string;
  holds: Hold[];
}

export type CrisisSet = 'positive' | 'heldOut' | 'negative' | 'knownFalsePositive' | 'knownHard' | 'field' | 'messy';

export interface EvalCase {
  id: string;
  suite: Suite;
  task: TaskName;
  path: string;
  /** Request body exactly as the route receives it. */
  body: unknown;
  /** Texts the reply may legitimately take numbers and drug names from (user words, plan, transcript). */
  ground: string[];
  forbidden: string[];
  holds: Hold[];
  /** Set per call by the runner: unique `x-real-ip`, so eval traffic never shares a rate-limit bucket. */
  ip?: string;
  memory?: string[];
  crisisSet?: CrisisSet;
  /** The attack text that was injected (red-team rows); used for the echo-of-payload signal. */
  payload?: string;
  /** Cross-user marker: the runner first sends a different 'user' request containing it; it must never appear in this reply. */
  seedMarker?: string;
  /** Tags from the dataset, e.g. seen-in-prompts / variant. */
  tags?: string[];
  /** Which arms this case is meaningful for (default both). */
  arms?: Arm[];
  /** Scripted multi-turn probe: the `me` lines come from here, the clinician lines are the model's own replies. */
  script?: { opener?: string; steps: ProbeStep[]; distinctReplies: number };
}

export interface CaseResult {
  caseId: string;
  suite: Suite;
  task: TaskName;
  arm: Arm;
  rep: number;
  cls: CaseClass;
  modelUsed: string | null;
  attempts: number;
  /** Safety flags raised on the final body, e.g. leak_canary, advice_dose, invented_number. */
  flags: string[];
  holdFailures: string[];
  /** Valid, non-empty, on-task: the paired positive metric. */
  onTask: boolean;
  crisisSet?: CrisisSet;
  tags?: string[];
  /** Baseline arm only: a 200 reply with no usable body. Counted as an on-task failure, not as a transport error (E-13). */
  malformed?: boolean;
  /** Number of HTTP requests this result covers (more than 1 only for the scripted probe). */
  requests: number;
  /** One entry per request, so latency can be reported for model_ok requests only (D38). */
  perRequest: { cls: CaseClass; latencyMs?: number; tier?: 'quality' | 'fast' | null }[];
  calls: CallUsage[];
  /** recap only */
  evidence?: { kept: number; dropped: number };
  /** True when no sentence is over 15 words and no idiom from the eval's own list is present. */
  lintClean?: boolean;
  promptVersion?: string;
}
