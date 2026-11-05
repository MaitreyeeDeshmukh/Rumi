/**
 * Optional Sentry. The package is NOT installed. This file is the only place the app talks to it, through a tiny
 * adapter, and it does nothing unless SENTRY_DSN is set AND an adapter was registered.
 *
 * To turn it on: `pnpm add @sentry/nextjs`, then in src/instrumentation.ts register(), after Sentry.init({ dsn, beforeSend: sentryBeforeSend,
 * sendDefaultPii: false, maxBreadcrumbs: 0, integrations: [] }), call
 * `setErrorReporter({ capture: (r) => Sentry.captureException(new Error(r.code), { fingerprint: [r.fingerprint], tags: { route: r.route, release: r.release } }) })`.
 * Never pass the original error: its message may hold user text.
 */
import { emitLine } from "@/lib/ai/telemetry";
import { sentryEnabled } from "./config";

/** What may leave the process: codes and a fingerprint. No message, no stack, no request, no user. */
export interface ErrorReport {
  code: string;
  fingerprint: string;
  route: string;
  release: string;
  status: number;
}

export interface ErrorReporter {
  capture(report: ErrorReport): void;
}

let reporter: ErrorReporter | null = null;

export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next;
}

/** Sends one scrubbed report. Never throws; a failing reporter costs one stdout line. */
export function reportError(report: ErrorReport): void {
  if (reporter === null || !sentryEnabled()) return;
  try {
    reporter.capture(report);
  } catch {
    // The reporter is third-party code. Its failure must never change a response, so it becomes one stdout line.
    emitLine(JSON.stringify({ type: "error_reporter_failed" }), "warn");
  }
}

type Json = Record<string, unknown>;
const REPLACEMENT_MESSAGE = "redacted";

/**
 * Sentry `beforeSend`: drops request bodies, cookies, headers, query strings, breadcrumbs, the user, extra data and
 * every exception message. Returns null (drop the event) when the event is not an object.
 */
export function sentryBeforeSend<T>(event: T): T | null {
  if (typeof event !== "object" || event === null) return null;
  const e = event as Json;
  delete e.request;
  delete e.user;
  delete e.breadcrumbs;
  delete e.extra;
  delete e.contexts;
  delete e.message;
  delete e.logentry;
  delete e.server_name;
  const exception = e.exception;
  if (typeof exception === "object" && exception !== null && Array.isArray((exception as Json).values)) {
    for (const v of (exception as { values: unknown[] }).values) {
      if (typeof v !== "object" || v === null) continue;
      const value = v as Json;
      value.value = REPLACEMENT_MESSAGE;
      delete value.stacktrace; // frames can carry local variable values; the fingerprint already groups by place
    }
  }
  return event;
}
