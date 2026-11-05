/**
 * The one catch-block helper for API routes. A caller fault (4xx) is a warning. A system fault (5xx) is one ERROR
 * line with a fingerprint plus a row in ops_app_events. The answer is always toResponse: code, fixed sentence, request id.
 */
import { asAppError, fingerprintOf, toResponse, type AppErrorCode } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { recordAppEvent, type AppEventArea } from "./sinks";
import { hit } from "./throttle";

const AREA: Partial<Record<AppErrorCode, AppEventArea>> = {
  unauthorized: "auth",
  forbidden: "auth",
  store_unavailable: "db",
  ai_invalid: "ai",
  ai_unavailable: "ai",
};

export function respondWithError(err: unknown, ctx: { requestId: string; route: string }): Response {
  const e = asAppError(err);
  const log = createLogger(ctx);
  if (e.status >= 500) {
    log.error("request_failed", err);
    recordAppEvent({ source: "server", area: AREA[e.code] ?? "app", code: e.code, fingerprint: fingerprintOf(err), route: ctx.route, status: e.status });
  } else {
    // Sampled: one line a minute per route and code per instance, carrying how many were skipped. A flood of 4xx must not flood the logs.
    const sample = hit(`rejected|${ctx.route}|${e.code}`);
    if (sample.allow) log.warn("request_rejected", { code: e.code, status: e.status, repeats: sample.repeats });
  }
  return toResponse(err, ctx.requestId);
}
