/**
 * Errors nobody caught: Next.js hands them to `onRequestError` (src/instrumentation.ts). One structured log line with a
 * fingerprint and one ops_app_events row. The message, stack and request are never read.
 */
import { asAppError, fingerprintOf } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { newRequestId, REQUEST_ID_HEADER } from "@/lib/requestContext";
import { recordAppEvent } from "./sinks";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function reportServerFault(err: unknown, routePath: string, headers?: Record<string, string | string[] | undefined>): void {
  const sent = headers?.[REQUEST_ID_HEADER];
  const requestId = typeof sent === "string" && UUID.test(sent) ? sent : newRequestId();
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  createLogger({ requestId, route: routePath }).error("unhandled_error", err, { digest });
  const e = asAppError(err);
  if (e.status >= 500) recordAppEvent({ source: "server", area: "app", code: e.expose ? e.code : "unhandled", fingerprint: fingerprintOf(err), route: routePath, status: e.status });
}
