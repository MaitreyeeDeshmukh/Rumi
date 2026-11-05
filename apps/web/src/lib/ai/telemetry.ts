/**
 * Telemetry: counts, ids and codes only. There is no field for user text, memory text or a key, and the writer
 * copies only known fields and checks their shape, so a mistake elsewhere cannot leak text into a log line.
 */
import { ALL_GUARD_CODES, logLabel, type GuardCode } from "@/features/shared/guards";
import type { TaskName, Tier } from "@/features/shared/task";
import type { ApiErrorCode } from "@/features/shared/types";

export type Outcome = "ok" | "mock" | "crisis" | "fallback" | "error";
export type EventErrorCode = ApiErrorCode | "config" | "unauthorized" | "timeout" | "internal" | "store_unavailable";
/** Where in the pipeline a request stopped or an unexpected error happened. A fixed list, never text. */
export type Stage = "guard" | "body" | "request" | "sanitize" | "crisis" | "redact" | "config" | "ledger" | "prompt" | "provider" | "output" | "reply" | "auth" | "flags" | "cache" | "limits";

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
  /**
   * True when the fallback was served on purpose and no provider was called: the kill switch (AI_FORCE_OFF or the
   * ai_enabled flag) or the daily spend cap. Without it a fallback with `ai_unavailable` means the provider failed.
   */
  paused?: boolean;
  /** The pipeline stage that failed, set when a request ended with an error or an unexpected exception. */
  stage?: Stage;
  /** Why the crisis card was shown. A fixed list, never text: tier1 regex, the model said yes, the model's own flag, or a fail-safe. */
  crisisSource?: CrisisSource;
  /** The kind of the last provider failure, its HTTP status and the last answer's finish reason. Codes only, never a body. */
  providerError?: string;
  providerStatus?: number;
  finishReason?: string;
}

export type CrisisSource = "tier1" | "model_yes" | "model_flag" | "failsafe_error" | "failsafe_off" | "failsafe_quota";
const CRISIS_SOURCES: readonly string[] = ["tier1", "model_yes", "model_flag", "failsafe_error", "failsafe_off", "failsafe_quota"];
const PROVIDER_ERRORS: readonly string[] = ["timeout", "http", "rate_limited", "rejected", "config", "empty", "aborted", "skipped"];
const FINISH_REASONS: readonly string[] = ["stop", "length", "other"];

const TASKS: readonly string[] = ["plan", "practice", "sayit", "recap"];
const OUTCOMES: readonly string[] = ["ok", "mock", "crisis", "fallback", "error"];
const TIERS: readonly string[] = ["quality", "fast", "none"];
const ERROR_CODES: readonly string[] = ["bad_input", "too_large", "forbidden", "ai_invalid", "ai_unavailable", "rate_limited", "config", "unauthorized", "timeout", "internal", "store_unavailable"];
const GUARD_CODES: readonly string[] = ALL_GUARD_CODES;
const REQUEST_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12})$/;
const STAGES: readonly string[] = ["guard", "body", "request", "sanitize", "crisis", "redact", "config", "ledger", "prompt", "provider", "output", "reply", "auth", "flags", "cache", "limits"];
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
    ...(e.paused === true ? { paused: true } : {}),
    ...(e.stage === undefined ? {} : { stage: oneOf(e.stage, STAGES, "unknown") }),
    ...(e.crisisSource === undefined ? {} : { crisisSource: oneOf(e.crisisSource, CRISIS_SOURCES, "unknown") }),
    ...(e.providerError === undefined ? {} : { providerError: oneOf(e.providerError, PROVIDER_ERRORS, "unknown") }),
    ...(typeof e.providerStatus === "number" && e.providerStatus >= 100 && e.providerStatus <= 599 ? { providerStatus: Math.floor(e.providerStatus) } : {}),
    ...(e.finishReason === undefined ? {} : { finishReason: oneOf(e.finishReason, FINISH_REASONS, "other") }),
  };
  return record;
}

/** The values `ops_ai_events.outcome` accepts (08 section 2). */
export type DbOutcome = "ok" | "degraded" | "crisis" | "rate_limited" | "invalid_input" | "provider_error" | "guard_blocked" | "unauthorized" | "timeout" | "config_error";

/**
 * The one mapping from the harness outcome to the stored outcome, or null when nothing is stored (mock).
 * ok->ok, crisis->crisis. A fallback is stored by its cause, because the error-rate alert reads provider_error and timeout:
 * timeout->timeout, config->config_error, ai_unavailable->provider_error (the provider failed), and degraded only when the
 * fallback was served on purpose (`paused`: kill switch or spend cap) or its cause is an invalid answer or unknown.
 * error by its code: forbidden and unauthorized->unauthorized, rate_limited->rate_limited, bad_input and too_large->invalid_input,
 * ai_unavailable->provider_error, ai_invalid->guard_blocked, config->config_error, timeout->timeout. Our own faults
 * (internal, store_unavailable, anything unknown) are not the provider's: they are stored as degraded and the code stays
 * in the stdout line. An error with no code at all stays provider_error.
 */
export function toDbOutcome(outcome: Outcome, errorCode?: EventErrorCode | "unknown", paused = false): DbOutcome | null {
  switch (outcome) {
    case "ok":
      return "ok";
    case "crisis":
      return "crisis";
    case "mock":
      return null;
    case "fallback":
      if (errorCode === "timeout") return "timeout";
      if (errorCode === "config") return "config_error";
      return errorCode === "ai_unavailable" && !paused ? "provider_error" : "degraded";
    case "error":
      switch (errorCode) {
        case "forbidden":
        case "unauthorized":
          return "unauthorized";
        case "rate_limited":
          return "rate_limited";
        case "bad_input":
        case "too_large":
          return "invalid_input";
        case "ai_invalid":
          return "guard_blocked";
        case "config":
          return "config_error";
        case "timeout":
          return "timeout";
        case "internal":
        case "store_unavailable":
        case "unknown":
          return "degraded";
        default:
          return "provider_error";
      }
  }
}
