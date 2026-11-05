/**
 * The one logger. One JSON line per call: ts, level, event, requestId, route, release, then the fields.
 * Redaction happens here, at the last step, so a careless caller cannot leak:
 *   - only fields on an ALLOWLIST are written, each checked against the shape that field must have; anything else is dropped;
 *   - a value that fails its shape, looks like an email or a token, or is a long string is replaced, never printed.
 * `error()` never writes an error message. It writes the code, the fingerprint and the status.
 * To log a new field, add it to FIELDS below with its shape.
 */
import { createHmac } from "node:crypto";
import { emitLine, type LogLevel } from "@/lib/ai/telemetry";
import { AppError, fingerprintOf } from "@/lib/errors";
import { hashingKey } from "@/lib/auth/secret";
import { getRelease } from "@/lib/telemetry/config";
import { reportError } from "@/lib/telemetry/sentry";

export type Fields = Record<string, string | number | boolean | undefined>;

export interface Logger {
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, err: unknown, fields?: Fields): void;
}

/** Lower-case words, digits and _ . : , - only: enough for codes, areas, outcomes and lists of variable names, not for prose. */
const WORD = /^[a-z0-9_.:,-]{1,80}$/;
type Shape = "number" | "boolean" | RegExp;
/** The only fields that can reach a log line. */
const FIELDS: Record<string, Shape> = {
  code: WORD,
  reason: WORD,
  area: WORD,
  source: WORD,
  outcome: WORD,
  task: WORD,
  tier: WORD,
  store: WORD,
  scope: WORD,
  names: /^[a-z0-9_.:,-]{1,120}$/,
  type: WORD,
  digest: /^[0-9]{5,20}$/,
  fingerprint: /^[a-f0-9]{16}$/,
  status: "number",
  count: "number",
  repeats: "number",
  dropped: "number",
  attempts: "number",
  ms: "number",
  seconds: "number",
  bytes: "number",
  ok: "boolean",
  suppressed: "boolean",
  // Added at integration for the AI harness and the memory routes: codes, counts and model names only, never text.
  kind: WORD,
  stage: WORD,
  pgcode: WORD,
  model: /^[a-z0-9_.:/-]{1,80}$/,
  tables: /^[a-z0-9_,]{1,120}$/,
  capUsd: "number",
  saved: "number",
  removed: "number",
  stored: "number",
  rejected: "number",
  granted: "boolean",
};
const MAX_STRING = 120;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** A JWT, a provider key, a bearer value, or an unbroken run of 24+ token characters holding a digit or capital (this also catches uuids). */
const TOKENISH = /eyJ[\w-]{5,}\.|\b[sS][kK][-_][\w-]{8,}|\b[Bb][Ee][Aa][Rr][Ee][Rr]\s+\S|(?=[\w+/=-]*[0-9A-Z])[\w+/=-]{24,}/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EVENT_NAME = /^[a-z0-9_.:-]{1,60}$/;
/** Work that belongs to no request (a startup read, a cached price lookup) names itself with one of these fixed words. They hold no data. */
const NO_REQUEST = new Set(["system", "process", "none"]);

/** Keyed (HMAC), so a marker cannot be matched against a dictionary of likely texts. Stable inside one deployment. */
const hashMarker = (s: string): string => `h:${createHmac("sha256", hashingKey()).update(s).digest("hex").slice(0, 12)}`;

function cleanValue(shape: Shape, v: string | number | boolean | undefined): string | number | boolean | undefined {
  if (v === undefined) return undefined;
  if (shape === "number") return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  if (shape === "boolean") return typeof v === "boolean" ? v : undefined;
  if (typeof v !== "string") return undefined;
  if (v.length > MAX_STRING) return hashMarker(v);
  if (EMAIL.test(v) || TOKENISH.test(v) || !shape.test(v)) return "[redacted]";
  return v;
}

/** Applies the allowlist and the value rules to a field bag. Exported for the tests. */
export function redactFields(fields: Fields | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (typeof fields !== "object" || fields === null) return out;
  for (const key of Object.keys(fields).slice(0, 30)) {
    const shape = Object.hasOwn(FIELDS, key) ? FIELDS[key] : undefined;
    if (shape === undefined) continue;
    const v = cleanValue(shape, fields[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Path only, no query string, no long segments, at most 80 characters. */
export const cleanRoute = (route: unknown): string => {
  const path = typeof route === "string" ? (route.split(/[?#]/)[0] ?? "") : "";
  return /^[A-Za-z0-9/_.[\]()@-]{1,80}$/.test(path) ? path : path === "" ? "unknown" : hashMarker(path);
};

export function createLogger(ctx: { requestId: string; route: string }): Logger {
  const requestId = REQUEST_ID.test(ctx.requestId) || NO_REQUEST.has(ctx.requestId) ? ctx.requestId : "invalid";
  const route = cleanRoute(ctx.route);

  function write(level: LogLevel, event: string, fields: Record<string, string | number | boolean>): void {
    try {
      const line = JSON.stringify({
        ...fields,
        ts: new Date().toISOString(),
        level,
        event: EVENT_NAME.test(event) ? event : "invalid_event",
        requestId,
        route,
        release: getRelease(),
      });
      emitLine(line, level);
    } catch {
      // Logging must never break a request. If even this fails there is nowhere left to write, so the line is lost.
    }
  }

  return {
    info: (event, fields) => write("info", event, redactFields(fields)),
    warn: (event, fields) => write("warn", event, redactFields(fields)),
    error(event, err, fields) {
      const e = err instanceof AppError ? err : undefined;
      const status = e?.status ?? 500;
      const code = e?.code ?? "internal";
      const fingerprint = fingerprintOf(err);
      // A caller fault (4xx) is the caller's mistake, not ours: warn, never ERROR, and never to the error reporter.
      const level: LogLevel = status >= 500 ? "error" : "warn";
      write(level, event, { ...redactFields(fields), code, fingerprint, status });
      if (level === "error") reportError({ code, fingerprint, route, release: getRelease(), status });
    },
  };
}
