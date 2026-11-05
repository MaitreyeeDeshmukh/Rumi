/**
 * Telemetry sinks. Each call writes ONE stdout line first, then tries the database inside `after()`, so the response
 * never waits. A store that is down, slow or throwing costs one warning line and nothing else: no throw, no retry storm.
 * Rows carry counts and codes only: no text, no user id, no key (see lib/ai/telemetry.ts for the field whitelist).
 */
import { after } from "next/server";
import { aiRecord, emitLine, type AiEvent } from "@/lib/ai/telemetry";
import { getRelease } from "./config";
import { telemetryDb } from "./db";
import { withTimeout } from "./timeout";

const STORE_TIMEOUT_MS = 2000;
/** After this many failures in a row the database is skipped for a while (stdout only), so a dead store cannot pile up work. */
const BREAKER_FAILS = 5;
const BREAKER_PAUSE_MS = 30_000;
const MAX_INFLIGHT = 50;

let fails = 0;
let pausedUntil = 0;
let inflight = 0;

/** Tests only: forget breaker state. */
export function resetSinkState(): void {
  fails = 0;
  pausedUntil = 0;
  inflight = 0;
}

function persist(store: string, job: () => PromiseLike<{ error: unknown }>): void {
  if (Date.now() < pausedUntil || inflight >= MAX_INFLIGHT) return; // the stdout line is already written
  inflight++;
  const run = async (): Promise<void> => {
    try {
      const { error } = await withTimeout(job(), STORE_TIMEOUT_MS);
      if (error) throw new Error("store_error");
      fails = 0;
    } catch (e) {
      const reason = e instanceof Error && e.message === "timeout" ? "timeout" : "error";
      emitLine(JSON.stringify({ type: "telemetry_store_failed", store, reason }), "warn");
      if (++fails >= BREAKER_FAILS) {
        fails = 0;
        pausedUntil = Date.now() + BREAKER_PAUSE_MS;
        emitLine(JSON.stringify({ type: "telemetry_store_paused", store, seconds: BREAKER_PAUSE_MS / 1000 }), "warn");
      }
    } finally {
      inflight--;
    }
  };
  try {
    after(run);
  } catch {
    // `after()` throws outside a request (startup hooks, scripts): run it now, still never awaited by the caller.
    void run();
  }
}

type DbOutcome =
  | "ok"
  | "degraded"
  | "crisis"
  | "rate_limited"
  | "invalid_input"
  | "provider_error"
  | "guard_blocked"
  | "unauthorized"
  | "timeout"
  | "config_error";

const ERROR_OUTCOME: Record<string, DbOutcome> = {
  forbidden: "unauthorized",
  rate_limited: "rate_limited",
  bad_input: "invalid_input",
  too_large: "invalid_input",
  ai_unavailable: "provider_error",
  ai_invalid: "guard_blocked",
  config: "config_error",
  timeout: "timeout",
};

/** Addendum section 2. `mock` is not stored (null). An error with a missing or new code counts as a provider error. */
export function dbOutcome(e: Pick<AiEvent, "outcome" | "errorCode">): DbOutcome | null {
  switch (e.outcome) {
    case "mock":
      return null;
    case "ok":
      return "ok";
    case "crisis":
      return "crisis";
    case "fallback":
      return "degraded";
    default:
      return ERROR_OUTCOME[e.errorCode ?? ""] ?? "provider_error";
  }
}

export type CacheStatus = "miss" | "hit" | "bypass";
const CACHE: readonly string[] = ["miss", "hit", "bypass"];
const BUCKET = /^[a-z0-9:_-]{1,40}$/;

export function recordAiEvent(e: AiEvent, extra: { cacheStatus: CacheStatus; cachedTokens: number; bucket: string }): void {
  try {
    const rec = aiRecord(e);
    const cacheStatus = CACHE.includes(extra?.cacheStatus) ? extra.cacheStatus : "bypass";
    const cachedTokens = typeof extra?.cachedTokens === "number" && Number.isFinite(extra.cachedTokens) ? Math.max(0, Math.floor(extra.cachedTokens)) : 0;
    emitLine(JSON.stringify({ ...rec, cacheStatus, cachedTokens }));

    const outcome = dbOutcome(rec as Pick<AiEvent, "outcome" | "errorCode">);
    if (outcome === null || rec.task === "unknown") return;
    const row = {
      task: rec.task,
      outcome,
      tier: rec.tier === "none" ? (outcome === "degraded" ? "fallback" : null) : rec.tier,
      prompt_version: rec.promptVersion === "invalid" ? null : rec.promptVersion,
      attempts: rec.attempts,
      guard_codes: rec.guardHits,
      latency_ms: rec.ms,
      input_tokens: rec.inTokens,
      output_tokens: rec.outTokens,
      bucket: typeof extra?.bucket === "string" && BUCKET.test(extra.bucket) ? extra.bucket : null,
      cache_status: cacheStatus,
      cached_tokens: cachedTokens,
    };
    persist("ops_ai_events", () => telemetryDb().from("ops_ai_events").insert(row));
  } catch {
    // Telemetry must never break a request. One line says it failed; the line holds no data from the event.
    emitLine(JSON.stringify({ type: "telemetry_failed", sink: "ai_event" }), "warn");
  }
}

export type AppEventArea = "auth" | "db" | "ai" | "memory" | "app" | "sync";
export type AppEventSource = "server" | "client" | "db";

export interface AppEvent {
  source: AppEventSource;
  area: AppEventArea;
  /** Stable machine code, a-z 0-9 . _ : - , up to 60 characters. */
  code: string;
  fingerprint?: string;
  /** A path, not a URL. Query strings are removed. */
  route?: string;
  status?: number;
}

const SOURCES: readonly string[] = ["server", "client", "db"];
const AREAS: readonly string[] = ["auth", "db", "ai", "memory", "app", "sync"];
const CODE = /^[a-z0-9_.:-]{1,60}$/;
const FINGERPRINT = /^[A-Za-z0-9]{1,64}$/;
const ROUTE = /^\/[A-Za-z0-9/_.[\]()@-]{0,79}$/;

/** Known fields only, each checked for shape; anything else becomes a fixed value or null. */
export function appRecord(e: AppEvent) {
  const route = typeof e?.route === "string" ? (e.route.split(/[?#]/)[0] ?? "") : "";
  const status = e?.status;
  return {
    source: SOURCES.includes(e?.source) ? e.source : "server",
    area: AREAS.includes(e?.area) ? e.area : "app",
    code: typeof e?.code === "string" && CODE.test(e.code) ? e.code : "invalid_code",
    fingerprint: typeof e?.fingerprint === "string" && FINGERPRINT.test(e.fingerprint) ? e.fingerprint : null,
    route: ROUTE.test(route) ? route : null,
    release: getRelease(),
    status: typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
  };
}

export function recordAppEvent(e: AppEvent): void {
  try {
    const r = appRecord(e);
    emitLine(JSON.stringify({ type: "app_event", ts: new Date().toISOString(), level: "info", ...r }));
    persist("ops_app_events", () =>
      telemetryDb().rpc("ops_log_app_event", {
        p_source: r.source,
        p_area: r.area,
        p_code: r.code,
        p_fingerprint: r.fingerprint,
        p_route: r.route,
        p_release: r.release,
        p_status: r.status,
      }),
    );
  } catch {
    // Same rule as recordAiEvent: never throw into a request.
    emitLine(JSON.stringify({ type: "telemetry_failed", sink: "app_event" }), "warn");
  }
}
