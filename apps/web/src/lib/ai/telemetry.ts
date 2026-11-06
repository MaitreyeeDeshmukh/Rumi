/**
 * Telemetry: counts, ids and codes only. There is no field for user text, memory text or a key, and the writer
 * copies only known fields and checks their shape, so a mistake elsewhere cannot leak text into a log line.
 */
import { ALL_GUARD_CODES, logLabel, type GuardCode } from "@/features/shared/guards";
import type { TaskName, Tier } from "@/features/shared/task";
import type { ApiErrorCode } from "@/features/shared/types";

export type Outcome = "ok" | "mock" | "crisis" | "fallback" | "error";
export type ProviderKind = "timeout" | "http" | "config" | "empty" | "aborted" | "none";
export type EventErrorCode = ApiErrorCode | "config";
/** Where in the pipeline a request stopped or an unexpected error happened. A fixed list, never text. */
export type Stage = "mock_prod" | "guard" | "body" | "request" | "sanitize" | "crisis" | "redact" | "config" | "ledger" | "prompt" | "provider" | "output" | "reply";

export interface AiEvent {
  /** A random request id (uuid). */
  id: string;
  task: TaskName;
  promptVersion: string;
  outcome: Outcome;
  /** True when the reply came from the deterministic fallback. */
  degraded: boolean;
  /** Provider calls made for this request, 0 to 3. */
  attempts: number;
  /** The tier of the last provider call, or "none" when no call was made. */
  tier: Tier | "none";
  redactions: number;
  injectionHits: number;
  thin: boolean;
  guardHits: readonly GuardCode[];
  /** How many stated preferences were put in the prompt. A count, never the text. */
  memoryItems: number;
  inTokens: number;
  outTokens: number;
  /** Estimated cost of all provider calls of this request in millionths of a US dollar (list prices, see cost.ts). A number, never text. */
  costMicroUsd: number;
  ms: number;
  errorCode?: EventErrorCode;
  /** The pipeline stage that failed, set when a request ended with an error or an unexpected exception. */
  stage?: Stage;
  /** The kind of the last failed provider call ("none" when no call failed). A fixed list, so outages are visible. */
  providerKind?: ProviderKind;
  /** Set only when the crisis classifier ran on text the regex layer let through (tier none): it answered, or it failed and the request went on. */
  classifier?: "none_ok" | "none_failed";
}

const TASKS: readonly string[] = ["plan", "practice", "sayit", "recap"];
const OUTCOMES: readonly string[] = ["ok", "mock", "crisis", "fallback", "error"];
const TIERS: readonly string[] = ["quality", "fast", "none"];
const ERROR_CODES: readonly string[] = ["bad_input", "too_large", "forbidden", "ai_invalid", "ai_unavailable", "rate_limited", "config"];
const GUARD_CODES: readonly string[] = ALL_GUARD_CODES;
const REQUEST_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12})$/;
const STAGES: readonly string[] = ["mock_prod", "guard", "body", "request", "sanitize", "crisis", "redact", "config", "ledger", "prompt", "provider", "output", "reply"];
const PROVIDER_KINDS: readonly string[] = ["timeout", "http", "config", "empty", "aborted", "none"];
const CLASSIFIER_RESULTS: readonly string[] = ["none_ok", "none_failed"];
const PROMPT_VERSION = /^[a-z]+@[0-9]{1,3}$/;

const count = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
const oneOf = (value: unknown, allowed: readonly string[], fallback: string): string =>
  typeof value === "string" && allowed.includes(value) ? value : fallback;
const shaped = (value: unknown, shape: RegExp): string => (typeof value === "string" && shape.test(value) ? value : "invalid");

let sink: (line: string) => void = (line) => console.log(line);

/** Tests capture log lines here. Pass null to restore console output. */
export function setLogSink(next: ((line: string) => void) | null): void {
  sink = next ?? ((line) => console.log(line));
}

export function logEvent(event: AiEvent): void {
  // The type says AiEvent; a bad caller or a cast must still not be able to crash a request or smuggle a field in.
  const e: Partial<AiEvent> = event ?? {};
  const record = {
    type: "ai_task",
    id: shaped(e.id, REQUEST_ID),
    task: oneOf(e.task, TASKS, "unknown"),
    promptVersion: shaped(e.promptVersion, PROMPT_VERSION),
    outcome: oneOf(e.outcome, OUTCOMES, "error"),
    degraded: e.degraded === true,
    attempts: Math.min(3, count(e.attempts)),
    tier: oneOf(e.tier, TIERS, "none"),
    redactions: count(e.redactions),
    injectionHits: count(e.injectionHits),
    thin: e.thin === true,
    guardHits: (Array.isArray(e.guardHits) ? e.guardHits : []).filter((c) => GUARD_CODES.includes(c)).map(logLabel),
    memoryItems: count(e.memoryItems),
    inTokens: count(e.inTokens),
    outTokens: count(e.outTokens),
    costMicroUsd: count(e.costMicroUsd),
    ms: count(e.ms),
    ...(e.errorCode === undefined ? {} : { errorCode: oneOf(e.errorCode, ERROR_CODES, "unknown") }),
    providerKind: oneOf(e.providerKind, PROVIDER_KINDS, "none"),
    ...(e.stage === undefined ? {} : { stage: oneOf(e.stage, STAGES, "unknown") }),
    ...(e.classifier === undefined ? {} : { classifier: oneOf(e.classifier, CLASSIFIER_RESULTS, "unknown") }),
  };
  sink(JSON.stringify(record));
}
