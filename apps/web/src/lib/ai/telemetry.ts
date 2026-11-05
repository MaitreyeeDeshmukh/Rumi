/**
 * Telemetry: counts, ids and codes only. There is no field for user text, memory text or a key, and the writer
 * copies only known fields and checks their shape, so a mistake elsewhere cannot leak text into a log line.
 */
import { ALL_GUARD_CODES, logLabel, type GuardCode } from "@/features/shared/guards";
import type { TaskName, Tier } from "@/features/shared/task";
import type { ApiErrorCode } from "@/features/shared/types";

export type Outcome = "ok" | "mock" | "crisis" | "fallback" | "error";
export type EventErrorCode = ApiErrorCode | "config" | "timeout";

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
  ms: number;
  errorCode?: EventErrorCode;
}

const TASKS: readonly string[] = ["plan", "practice", "sayit", "recap"];
const OUTCOMES: readonly string[] = ["ok", "mock", "crisis", "fallback", "error"];
const TIERS: readonly string[] = ["quality", "fast", "none"];
const ERROR_CODES: readonly string[] = ["bad_input", "too_large", "forbidden", "ai_invalid", "ai_unavailable", "rate_limited", "config", "timeout"];
const GUARD_CODES: readonly string[] = ALL_GUARD_CODES;
const REQUEST_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12})$/;
const PROMPT_VERSION = /^[a-z]+@[0-9]{1,3}$/;

const count = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
const oneOf = (value: unknown, allowed: readonly string[], fallback: string): string =>
  typeof value === "string" && allowed.includes(value) ? value : fallback;
const shaped = (value: unknown, shape: RegExp): string => (typeof value === "string" && shape.test(value) ? value : "invalid");

export type LogLevel = "info" | "warn" | "error";

const consoleSink = (line: string, level?: LogLevel): void => (level === "error" ? console.error(line) : level === "warn" ? console.warn(line) : console.log(line));
let sink: (line: string, level?: LogLevel) => void = consoleSink;

/** Tests capture log lines here. Pass null to restore console output. */
export function setLogSink(next: ((line: string, level?: LogLevel) => void) | null): void {
  sink = next ?? consoleSink;
}

/** The one place a log line leaves the process. Used by this file, lib/log.ts and lib/telemetry/sinks.ts. */
export function emitLine(line: string, level?: LogLevel): void {
  sink(line, level);
}

/** The event as it is written to stdout and to ops_ai_events: known fields only, each checked for shape. */
export function aiRecord(event: AiEvent) {
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
    ms: count(e.ms),
    ...(e.errorCode === undefined ? {} : { errorCode: oneOf(e.errorCode, ERROR_CODES, "unknown") }),
  };
  return record;
}

export function logEvent(event: AiEvent): void {
  emitLine(JSON.stringify(aiRecord(event)));
}
