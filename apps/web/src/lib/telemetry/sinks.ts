/**
 * Telemetry sinks. Each call writes ONE stdout line first, then tries the database inside `after()`, so the response
 * never waits. A store that is down, slow or throwing costs one warning line and nothing else: no throw, no retry storm.
 * Rows carry counts and codes only: no text, no user id, no key (see lib/ai/telemetry.ts for the field whitelist).
 */
import { after } from "next/server";
import { aiRecord, emitLine, toDbOutcome, type AiEvent, type DbOutcome } from "@/lib/ai/telemetry";
import { dbWritesEnabled, getRelease } from "./config";
import { telemetryDb, type TelemetryTable } from "./db";
import { hit } from "./throttle";
import { withTimeout } from "./timeout";

const STORE_TIMEOUT_MS = 2000;
/** After this many failures in a row a store is skipped for a while (stdout only), so a dead store cannot pile up work. */
const BREAKER_FAILS = 5;
const BREAKER_PAUSE_MS = 30_000;
const MAX_INFLIGHT = 50;
const DROP_LINE_EVERY_MS = 60_000;
/** App events: one row per (source, code, fingerprint, route) per minute per instance, and this many rows per minute in all. */
const APP_ROW_WINDOW_MS = 60_000;
const APP_ROWS_PER_MINUTE = 120;

/**
 * One state per store, so a dead ops_ai_events cannot pause ops_app_events.
 * Closed -> (5 failures in a row) -> open for 30 s -> half-open: exactly ONE probe call; its success closes the breaker,
 * its failure opens it again. While open or probing every other write is dropped.
 */
interface StoreState {
  fails: number;
  pausedUntil: number;
  probing: boolean;
  inflight: number;
}
const stores = new Map<TelemetryTable, StoreState>();
const stateOf = (store: TelemetryTable): StoreState => {
  let s = stores.get(store);
  if (s === undefined) stores.set(store, (s = { fails: 0, pausedUntil: 0, probing: false, inflight: 0 }));
  return s;
};

let dropped = 0;
let lastDropLine = 0;
let appWindow = { start: 0, rows: 0 };

/** Tests only: forget breaker, drop and window state. */
export function resetSinkState(): void {
  stores.clear();
  dropped = 0;
  lastDropLine = 0;
  appWindow = { start: 0, rows: 0 };
}

/** A write that was skipped because the store is paused or busy. Counted, and reported at most once a minute. */
function noteDrop(store: string): void {
  dropped++;
  const now = Date.now();
  if (now - lastDropLine < DROP_LINE_EVERY_MS) return;
  emitLine(JSON.stringify({ type: "telemetry_dropped", store, dropped }), "warn");
  dropped = 0;
  lastDropLine = now;
}

function persist(store: TelemetryTable, job: () => PromiseLike<{ error: unknown }>): void {
  if (!dbWritesEnabled()) return; // kill switch: stdout only
  const s = stateOf(store);
  const open = s.pausedUntil > 0;
  if (open && (Date.now() < s.pausedUntil || s.probing)) return noteDrop(store);
  if (!open && s.inflight >= MAX_INFLIGHT) return noteDrop(store);
  const probe = open; // paused time is over and nobody is probing: this call is the one probe
  if (probe) s.probing = true;
  s.inflight++;
  const run = async (): Promise<void> => {
    try {
      const { error } = await withTimeout(job(), STORE_TIMEOUT_MS);
      if (error) throw new Error("store_error");
      if (probe) {
        s.pausedUntil = 0;
        s.probing = false;
      }
      if (!probe && s.pausedUntil === 0) s.fails = 0; // a late success from before the breaker opened does not close it
    } catch (e) {
      const reason = e instanceof Error && e.message === "timeout" ? "timeout" : "error";
      emitLine(JSON.stringify({ type: "telemetry_store_failed", store, reason }), "warn");
      if (probe) {
        s.probing = false;
        s.pausedUntil = Date.now() + BREAKER_PAUSE_MS;
      } else if (s.pausedUntil === 0 && ++s.fails >= BREAKER_FAILS) {
        s.fails = 0;
        s.pausedUntil = Date.now() + BREAKER_PAUSE_MS;
        emitLine(JSON.stringify({ type: "telemetry_store_paused", store, seconds: BREAKER_PAUSE_MS / 1000 }), "warn");
      }
    } finally {
      s.inflight--;
    }
  };
  try {
    after(run);
  } catch {
    // `after()` throws outside a request (startup hooks, scripts): run it now, still never awaited by the caller.
    void run();
  }
}

/** Addendum section 2. The one mapping lives in lib/ai/telemetry.ts; `mock` is not stored (null). */
export const dbOutcome = (e: Pick<AiEvent, "outcome" | "errorCode" | "paused">): DbOutcome | null => toDbOutcome(e.outcome, e.errorCode, e.paused === true);

export type CacheStatus = "miss" | "hit" | "bypass";
const CACHE: readonly string[] = ["miss", "hit", "bypass"];
const BUCKET = /^[a-z0-9:_-]{1,40}$/;
/** A model id as providers write it (letters, digits, dot, dash, underscore, colon, slash), at most 80 characters (the column limit). */
const MODEL = /^[A-Za-z0-9._:/-]{1,80}$/;
/** cost_micro_usd is an int4. */
const MAX_COST_MICRO = 2_147_483_647;

export function recordAiEvent(e: AiEvent, extra: { cacheStatus: CacheStatus; cachedTokens: number; bucket?: string; model?: string; costMicro?: number }): void {
  try {
    const rec = aiRecord(e);
    const cacheStatus = CACHE.includes(extra?.cacheStatus) ? extra.cacheStatus : "bypass";
    const cachedTokens = typeof extra?.cachedTokens === "number" && Number.isFinite(extra.cachedTokens) ? Math.max(0, Math.floor(extra.cachedTokens)) : 0;
    emitLine(JSON.stringify({ ...rec, cacheStatus, cachedTokens }));

    const outcome = dbOutcome(rec as Pick<AiEvent, "outcome" | "errorCode" | "paused">);
    if (outcome === null || rec.task === "unknown") return;
    const model = typeof extra?.model === "string" && MODEL.test(extra.model) ? extra.model : null;
    const cost = typeof extra?.costMicro === "number" && Number.isFinite(extra.costMicro) ? Math.min(MAX_COST_MICRO, Math.max(0, Math.round(extra.costMicro))) : null;
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
      // Only when known: a fallback with no provider call has no model, and a cost of 0 is not stored as a cost.
      ...(model === null ? {} : { model }),
      ...(cost === null || cost === 0 ? {} : { cost_micro_usd: cost }),
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
const ROUTE = /^(?:\/[A-Za-z0-9/_.[\]()@-]{0,79}|unknown)$/;

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
    const per = hit(`app|${r.source}|${r.code}|${r.fingerprint}|${r.route}`, APP_ROW_WINDOW_MS, 1);
    const line: Record<string, unknown> = { type: "app_event", ts: new Date().toISOString(), level: "info", ...r };
    if (!per.allow) line.suppressed = true;
    else if (per.repeats > 0) line.repeats = per.repeats; // events refused since the last row for this key
    emitLine(JSON.stringify(line));
    if (!per.allow) return;
    const now = Date.now();
    if (now - appWindow.start >= APP_ROW_WINDOW_MS) appWindow = { start: now, rows: 0 };
    if (appWindow.rows >= APP_ROWS_PER_MINUTE) return noteDrop("ops_app_events");
    appWindow.rows++;
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
