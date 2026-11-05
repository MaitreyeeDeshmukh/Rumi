/**
 * Telemetry: counts, ids and codes only. There is no field for user text, memory text or a key, and the writer
 * copies only known fields and checks their shape, so a mistake elsewhere cannot leak text into a log line.
 */
import { ALL_GUARD_CODES, logLabel, type GuardCode } from "@/features/shared/guards";
import type { TaskName, Tier } from "@/features/shared/task";
import type { ApiErrorCode } from "@/features/shared/types";

export type Outcome = "ok" | "mock" | "crisis" | "fallback" | "error";
export type EventErrorCode = ApiErrorCode | "config" | "unauthorized" | "timeout";
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
  /** The pipeline stage that failed, set when a request ended with an error or an unexpected exception. */
  stage?: Stage;
}

const TASKS: readonly string[] = ["plan", "practice", "sayit", "recap"];
const OUTCOMES: readonly string[] = ["ok", "mock", "crisis", "fallback", "error"];
const TIERS: readonly string[] = ["quality", "fast", "none"];
const ERROR_CODES: readonly string[] = ["bad_input", "too_large", "forbidden", "ai_invalid", "ai_unavailable", "rate_limited", "config", "unauthorized", "timeout"];
const GUARD_CODES: readonly string[] = ALL_GUARD_CODES;
const REQUEST_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12})$/;
const STAGES: readonly string[] = ["guard", "body", "request", "sanitize", "crisis", "redact", "config", "ledger", "prompt", "provider", "output", "reply", "auth", "flags", "cache", "limits"];
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
    ms: count(e.ms),
    ...(e.errorCode === undefined ? {} : { errorCode: oneOf(e.errorCode, ERROR_CODES, "unknown") }),
    ...(e.stage === undefined ? {} : { stage: oneOf(e.stage, STAGES, "unknown") }),
  };
  sink(JSON.stringify(record));
}

/** The values `ops_ai_events.outcome` accepts (08 section 2). */
export type DbOutcome = "ok" | "degraded" | "crisis" | "rate_limited" | "invalid_input" | "provider_error" | "guard_blocked" | "unauthorized" | "timeout" | "config_error";

/**
 * The one mapping from the harness outcome to the stored outcome, or null when nothing is stored (mock).
 * ok->ok, crisis->crisis, fallback->degraded (a fallback caused by timeouts or by missing configuration is stored as
 * timeout or config_error, because those are the causes an operator needs to see), error by its code:
 * forbidden->unauthorized, unauthorized->unauthorized, rate_limited->rate_limited, bad_input and too_large->invalid_input,
 * ai_unavailable->provider_error, ai_invalid->guard_blocked, config->config_error, timeout->timeout.
 */
export function toDbOutcome(outcome: Outcome, errorCode?: EventErrorCode): DbOutcome | null {
  switch (outcome) {
    case "ok":
      return "ok";
    case "crisis":
      return "crisis";
    case "mock":
      return null;
    case "fallback":
      return errorCode === "timeout" ? "timeout" : errorCode === "config" ? "config_error" : "degraded";
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
        default:
          return "provider_error";
      }
  }
}
