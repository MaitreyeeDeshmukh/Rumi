/**
 * One error type for the whole server. A code, a status and a fixed sentence. The message of an error from
 * outside our own code is never read, logged or sent: only the code is.
 */
import { createHash } from "node:crypto";

export type AppErrorCode =
  | "bad_input"
  | "too_large"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "ai_invalid"
  | "ai_unavailable"
  | "store_unavailable"
  | "config"
  | "internal";

const STATUS: Record<AppErrorCode, number> = {
  bad_input: 400,
  too_large: 413,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  ai_invalid: 502,
  ai_unavailable: 503,
  store_unavailable: 503,
  config: 500,
  internal: 500,
};

/** Plain sentences for the person using the app. Literal, short, no blame, no internals. */
export const MESSAGES: Record<AppErrorCode, string> = {
  bad_input: "I could not read that. Check what you wrote and try again.",
  too_large: "That is too long. Make it shorter and try again.",
  unauthorized: "Saving is paused. Your work is on this device. Try again in a moment.",
  forbidden: "This request was blocked. Reload the page and try again.",
  not_found: "I could not find that.",
  conflict: "That changed while you were working. Reload and try again.",
  rate_limited: "That was too many tries. Wait one minute and try again.",
  ai_invalid: "I could not make a safe answer. Your work is saved. Try again.",
  ai_unavailable: "I could not reach the AI. Your work is saved. Try again.",
  store_unavailable: "Saving is paused. Your work is on this device.",
  config: "Something went wrong on our side. Try again later.",
  internal: "Something went wrong on our side. Try again later.",
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** False when the client must not learn the code (internal and config faults): the response says "internal". */
  readonly expose: boolean;
  /** Seconds until the caller may try again. Sent as Retry-After on a 429. */
  readonly retryAfterSec?: number;

  constructor(code: AppErrorCode, options: { status?: number; cause?: unknown; retryAfterSec?: number } = {}) {
    // The message is the code: it is the only text of ours that may ever reach a log line.
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? STATUS[code];
    this.expose = code !== "internal" && code !== "config";
    this.retryAfterSec = options.retryAfterSec;
    // Start the stack at the caller, so the fingerprint points at where the fault was raised, not at this constructor.
    Error.captureStackTrace?.(this, new.target);
  }
}

/** Anything thrown becomes an AppError. Unknown values become `internal` with the original kept as the cause. */
export function asAppError(err: unknown): AppError {
  return err instanceof AppError ? err : new AppError("internal", { cause: err });
}

const retryAfter = (sec: number | undefined): number => (sec !== undefined && Number.isFinite(sec) ? Math.min(3600, Math.max(1, Math.ceil(sec))) : 60);

/** RFC 7807 style answer: code, a fixed sentence and the request id. Never `e.message`. Private: never cached. */
export function toResponse(err: unknown, requestId: string): Response {
  const e = asAppError(err);
  const code: AppErrorCode = e.expose ? e.code : "internal";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "x-request-id": requestId,
  };
  if (e.status === 429) headers["Retry-After"] = String(retryAfter(e.retryAfterSec));
  return new Response(JSON.stringify({ error: { code, message: MESSAGES[code], requestId } }), { status: e.status, headers });
}

const FRAME = /(.+):(\d+):\d+\)?$/;

/**
 * Stable 16 hex characters from the code and the first stack frame (file name and line, no column, no folder).
 * The message is never used, so two faults at one place group together whatever text they carry.
 * It never throws: a value with no stack, a string or a circular object still gets a fingerprint.
 */
export function fingerprintOf(err: unknown): string {
  const code = err instanceof AppError ? err.code : "internal";
  let frame = "nostack";
  try {
    const stack = err instanceof Error && typeof err.stack === "string" ? err.stack.slice(0, 4000) : "";
    // Only lines that start with "at " are frames; a multi-line message must not be mistaken for one.
    for (const line of stack.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("at ")).slice(0, 10)) {
      const m = FRAME.exec(line);
      if (m) {
        frame = `${(m[1].split(/[\\/]/).pop() ?? "").split("?")[0]}:${m[2]}`;
        break;
      }
    }
  } catch {
    // A hostile `stack` getter must not break error handling; the fingerprint then rests on the code alone.
  }
  return createHash("sha256").update(`${code}|${frame}`).digest("hex").slice(0, 16);
}
