/**
 * TaskSpec v2: the interface between the harness (src/lib/ai) and each AI task (src/features/<task>).
 * Frozen in Phase 0. Differences from the first draft are listed in 07-p0-roast-resolutions.md section 1.
 */
import type { z } from 'zod';
import type { GuardCode } from './guards';

export type TaskName = 'plan' | 'practice' | 'sayit' | 'recap';
export type Tier = 'quality' | 'fast';

export type EvidenceSource = 'user_words' | 'plan' | 'transcript';

export interface EvidenceItem {
  /** Internal id, e1, e2, ... */
  id: string;
  /** What the prompt shows and the model cites: U1.. for user words, q1.. for plan items, L1.. for transcript lines. */
  label: string;
  text: string;
  source: EvidenceSource;
}

export interface EvidenceLedger {
  items: EvidenceItem[];
  /** True when the user gave fewer than two sentences. Drives the optional "add one detail" nudge only, never lint severity. */
  thin: boolean;
}

export interface BuildContext<Req> {
  /** The request with every string leaf sanitized (promptForm). Never the raw body. */
  r: Req;
  ledger: EvidenceLedger;
  /** Fence one user-origin string with this request's nonce. The only way user text may enter a prompt. */
  fence: (label: string, text: string) => string;
  /** Stated persona preferences as plain strings, already derived and sanitized. The harness fences them inside STYLE. */
  memory: string[];
  companionName: string;
}

export interface TaskSpec<Req, Out, Reply> {
  name: TaskName;
  promptVersion: string;
  /** Which model tier the first call uses. A provider error swaps tier once. */
  tier: Tier;
  request: z.ZodType<Req>;
  modelOut: z.ZodType<Out>;
  reply: z.ZodType<Reply>;
  /** Only text the user typed in THIS request gets the crisis check (latest me turn, rawText, clinicianQuestion). */
  crisisFields: (r: Req) => Record<string, string>;
  buildLedger: (r: Req) => EvidenceLedger;
  build: (ctx: BuildContext<Req>) => { system: string; user: string };
  /** Pure domain checks. Returns guard codes only. Severity comes from guards.ts. */
  validate: (r: Req, o: Out, ledger: EvidenceLedger) => GuardCode[];
  /** Model output to wire reply: map labels back to ids, run the evidence check, derive blanks. Pure. */
  finalize: (r: Req, o: Out, ledger: EvidenceLedger) => Reply;
  /** Deterministic, no model, must satisfy `reply`. Used when the provider is down or both attempts fail hard. */
  fallback: (r: Req) => Reply;
  /** False only for recap, which quotes doses said in the visit. */
  adviceGuard: boolean;
  useMemory: boolean;
  temperature: number;
  maxOutputTokens: number;
  /** Used when MOCK_AI=1. Must satisfy `reply`. */
  mock: (r: Req) => Reply;
}
