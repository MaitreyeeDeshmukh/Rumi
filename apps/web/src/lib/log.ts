/**
 * The one logger. One JSON line per call: ts, level, event, requestId, route, release, then the fields.
 * Redaction happens here, at the last step, so a careless caller cannot leak: keys that name text, secrets or
 * identities are dropped, values that look like an email or a token are replaced, and long strings become a hash marker.
 * `error()` never writes an error message. It writes the code, the fingerprint and the status.
 */
import { createHash } from "node:crypto";
import { emitLine, type LogLevel } from "@/lib/ai/telemetry";
import { AppError, fingerprintOf } from "@/lib/errors";
import { getRelease } from "@/lib/telemetry/config";
import { reportError } from "@/lib/telemetry/sentry";

export type Fields = Record<string, string | number | boolean | undefined>;

export interface Logger {
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, err: unknown, fields?: Fields): void;
}

/** Keys that name user text, secrets or identities. Matched anywhere in the key, any case. */
const DROP_KEY = /text|body|content|prompt|message|email|token|key|secret|password|authorization|cookie|userid|user_id|(?:^|_)uid(?:$|_)/i;
const MAX_STRING = 120;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** A JWT, a provider key, a bearer value, or an unbroken run of 24+ token characters holding a digit or capital (this also catches uuids). */
const TOKENISH = /eyJ[\w-]{5,}\.|\b[sS][kK][-_][\w-]{8,}|\b[Bb][Ee][Aa][Rr][Ee][Rr]\s+\S|(?=[\w+/=-]*[0-9A-Z])[\w+/=-]{24,}/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EVENT_NAME = /^[a-z0-9_.:-]{1,60}$/;

const hashMarker = (s: string): string => `h:${createHash("sha256").update(s).digest("hex").slice(0, 12)}`;

function cleanValue(v: string | number | boolean | undefined): string | number | boolean | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return typeof v === "boolean" ? v : undefined;
  if (v.length > MAX_STRING) return hashMarker(v);
  if (EMAIL.test(v) || TOKENISH.test(v)) return "[redacted]";
  return v;
}

/** Applies the redaction rules to a field bag. Exported for the tests. */
export function redactFields(fields: Fields | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (typeof fields !== "object" || fields === null) return out;
  for (const key of Object.keys(fields).slice(0, 30)) {
    if (DROP_KEY.test(key)) continue;
    const v = cleanValue(fields[key]);
    if (v !== undefined) out[key.slice(0, 40)] = v;
  }
  return out;
}

/** Path only, no query string, no long segments, at most 80 characters. */
export const cleanRoute = (route: unknown): string => {
  const path = typeof route === "string" ? (route.split(/[?#]/)[0] ?? "") : "";
  return /^[A-Za-z0-9/_.[\]()@-]{1,80}$/.test(path) ? path : path === "" ? "unknown" : hashMarker(path);
};

export function createLogger(ctx: { requestId: string; route: string }): Logger {
  const requestId = REQUEST_ID.test(ctx.requestId) ? ctx.requestId : "invalid";
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
