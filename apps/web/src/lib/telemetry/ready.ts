/**
 * Readiness: can this instance do real work? Checks configuration and one cheap database call (2 s cap).
 * Answers are cached for 5 s and shared by concurrent callers, so a flood of /api/ready calls cannot become a flood on the database.
 * The result is a list of dependency NAMES, never a message, a value or a URL.
 */
import { createLogger } from "@/lib/log";
import { missingEnvNames } from "./config";
import { telemetryDb } from "./db";
import { withTimeout } from "./timeout";

const DB_TIMEOUT_MS = 2000;
const CACHE_MS = 5000;

let cache: { at: number; failed: string[] } | null = null;
let pending: Promise<string[]> | null = null;

/** Tests only. */
export function resetReadyCache(): void {
  cache = null;
  pending = null;
}

async function probe(requestId: string): Promise<string[]> {
  const log = createLogger({ requestId, route: "/api/ready" });
  const failed: string[] = [];
  const missing = missingEnvNames();
  if (missing.length > 0) {
    failed.push("env");
    // Lowercase on purpose: the logger would redact an upper-case run this long as a possible token.
    log.warn("ready_env_missing", { names: missing.join(",").toLowerCase() });
  }
  try {
    const { error } = await withTimeout(telemetryDb().rpc("ops_ai_usage_total", { p_day: new Date().toISOString().slice(0, 10), p_bucket: "global" }), DB_TIMEOUT_MS);
    if (error) throw new Error("rpc_error");
  } catch (e) {
    failed.push("database");
    log.warn("ready_database_failed", { reason: e instanceof Error && e.message === "timeout" ? "timeout" : "error" });
  }
  return failed;
}

/** Names of the dependencies that failed; empty means ready. */
export async function checkReady(requestId: string): Promise<string[]> {
  if (cache !== null && Date.now() - cache.at < CACHE_MS) return cache.failed;
  pending ??= probe(requestId)
    .then((failed) => {
      cache = { at: Date.now(), failed };
      return failed;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
