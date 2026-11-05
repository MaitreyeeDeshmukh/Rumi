/**
 * Daily usage limits and the global spend cap, counted in Supabase (`ops_bump_ai_usage`, `ops_ai_usage_total`) through
 * the admin client. Buckets: `u:<hash16>` per signed-in user, `ip:<hash8>` per hashed address, `global` for cost.
 * Counts only: no text, no user id, no address. When the store fails, an in-memory counter takes over and ONE
 * `ops_app_events` record (area ai, code usage_store_down) says so; the request is still served.
 *
 * Known limits: the read-then-bump pair is not atomic, so concurrent requests can pass a limit by a few calls.
 * The in-memory fallback is per instance. A signed-in user may share an address with others, so the address limit
 * is five times the user limit for them; a signed-out caller is limited by address alone at the plain limit.
 */
import type { TaskName } from "@/features/shared/task";
import { getLimits } from "@/lib/env";
import { createLogger } from "@/lib/log";
import { getAdminClient } from "@/lib/supabase/admin";
import { recordAppEvent } from "@/lib/telemetry/sinks";

/** Used when AI_DAILY_USER_LIMIT / AI_DAILY_GLOBAL_SPEND_CAP_USD are unset (the plan's defaults until the team chooses). */
const DEFAULT_USER_LIMIT = 60;
const DEFAULT_SPEND_CAP_USD = 10;
const SHARED_ADDRESS_FACTOR = 5;
const STORE_MS = 1_500;
const SPEND_REFRESH_MS = 30_000;
const DOWN_REPEAT_MS = 5 * 60_000;
const MEMORY_KEYS_MAX = 5_000;

export type LimitVerdict = { ok: true } | { ok: false; retryAfterSec: number };

let clock: () => number = Date.now;
const utcDay = (t: number): string => new Date(t).toISOString().slice(0, 10);
const secondsToUtcMidnight = (t: number): number => {
  const next = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - t) / 1000));
};

const userBucket = (userHash: string): string => `u:${userHash.slice(0, 16)}`;
const ipBucket = (ipHash: string): string => `ip:${ipHash.slice(0, 8)}`;
/** The bucket a telemetry line carries: the user's when signed in, else the address's. */
export const bucketOf = (userHash: string | null, ipHash: string): string => (userHash === null ? ipBucket(ipHash) : userBucket(userHash));

/** Reject a store call that takes too long or comes back with an error. */
async function store<T>(call: PromiseLike<{ data: unknown; error: unknown }>, shape: (data: unknown) => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("usage store timeout")), STORE_MS);
  });
  try {
    const { data, error } = await Promise.race([Promise.resolve(call), timeout]);
    if (error) throw new Error("usage store error");
    return shape(data);
  } finally {
    clearTimeout(timer);
  }
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw new Error("usage store returned a bad number");
  return n;
};

/** `ops_ai_usage_total` returns one row: { calls, cost_micro_usd }. */
async function total(bucket: string, day: string): Promise<{ calls: number; cost: number }> {
  return store(getAdminClient().rpc("ops_ai_usage_total", { p_day: day, p_bucket: bucket }), (data) => {
    const row = Array.isArray(data) ? (data[0] as { calls?: unknown; cost_micro_usd?: unknown } | undefined) : undefined;
    if (row === undefined) return { calls: 0, cost: 0 };
    return { calls: num(row.calls), cost: num(row.cost_micro_usd) };
  });
}

async function bump(bucket: string, calls: number, costMicroUsd: number): Promise<void> {
  await store(getAdminClient().rpc("ops_bump_ai_usage", { p_bucket: bucket, p_calls: calls, p_cost_micro_usd: costMicroUsd }), () => undefined);
}

// ---------------------------------------------------------------- store down: one record, in-memory counters

let downReportedAt = Number.NEGATIVE_INFINITY;
function reportStoreDown(): void {
  if (clock() - downReportedAt < DOWN_REPEAT_MS) return;
  downReportedAt = clock();
  recordAppEvent({ source: "server", area: "ai", code: "usage_store_down" });
}

const memory = new Map<string, { day: string; calls: number }>();
function memoryCount(bucket: string, day: string): number {
  const hit = memory.get(bucket);
  return hit !== undefined && hit.day === day ? hit.calls : 0;
}
function memoryBump(bucket: string, day: string): void {
  const calls = memoryCount(bucket, day) + 1;
  memory.delete(bucket);
  memory.set(bucket, { day, calls });
  while (memory.size > MEMORY_KEYS_MAX) {
    const oldest = memory.keys().next();
    if (oldest.done) return;
    memory.delete(oldest.value);
  }
}

// ---------------------------------------------------------------- the per-request check

export async function checkAndBump(args: { userHash: string | null; ipHash: string; task: TaskName }): Promise<LimitVerdict> {
  const now = clock();
  const day = utcDay(now);
  const userLimit = getLimits().dailyUserLimit ?? DEFAULT_USER_LIMIT;
  const buckets: Array<{ name: string; limit: number }> = [{ name: ipBucket(args.ipHash), limit: args.userHash === null ? userLimit : userLimit * SHARED_ADDRESS_FACTOR }];
  if (args.userHash !== null) buckets.push({ name: userBucket(args.userHash), limit: userLimit });
  const refuse: LimitVerdict = { ok: false, retryAfterSec: secondsToUtcMidnight(now) };

  try {
    const used = await Promise.all(buckets.map((b) => total(b.name, day)));
    if (buckets.some((b, i) => used[i].calls >= b.limit)) return refuse;
    await Promise.all(buckets.map((b) => bump(b.name, 1, 0)));
    return { ok: true };
  } catch {
    // Store down, slow or confusing: count here instead and say so once. The request is still served (fail open).
    reportStoreDown();
    if (buckets.some((b) => memoryCount(b.name, day) >= b.limit)) return refuse;
    for (const b of buckets) memoryBump(b.name, day);
    return { ok: true };
  }
}

// ---------------------------------------------------------------- cost and the global spend cap

/** USD per 1M tokens, which is numerically micro-USD per token. Groq model pages, read 2026-11-05. [VERIFY] before launch. */
const PRICE = {
  "gpt-oss-120b": { input: 0.15, cached: 0.075, output: 0.6 },
  "gpt-oss-20b": { input: 0.075, cached: 0.0375, output: 0.3 },
} as const;

/** Micro-USD for one call. A model name we do not know is priced as the larger model, so the cap errs on the safe side. */
export function costMicroUsd(model: string, inTokens: number, cachedTokens: number, outTokens: number): number {
  const p = model.includes("gpt-oss-20b") ? PRICE["gpt-oss-20b"] : PRICE["gpt-oss-120b"];
  const cached = Math.min(Math.max(0, cachedTokens), Math.max(0, inTokens));
  return Math.ceil((Math.max(0, inTokens) - cached) * p.input + cached * p.cached + Math.max(0, outTokens) * p.output);
}

const spend = { day: "", base: 0, local: 0, readAt: Number.NEGATIVE_INFINITY, announcedDay: "" };

/** Adds one request's cost: remembered here at once, written to the `global` bucket without waiting for the store. */
export function recordSpend(costMicro: number): void {
  const day = utcDay(clock());
  if (spend.day !== day) Object.assign(spend, { day, base: 0, local: 0, readAt: Number.NEGATIVE_INFINITY });
  spend.local += costMicro;
  bump("global", 1, costMicro).catch(() => reportStoreDown());
}

/**
 * True once today's global spend has reached AI_DAILY_GLOBAL_SPEND_CAP_USD. The stored total is read at most every 30 s;
 * this instance's own spend since then is added, so a busy instance trips early. A store failure falls back to this
 * instance's own count. Logs once per day when it first trips.
 */
export async function spendCapReached(): Promise<boolean> {
  const now = clock();
  const day = utcDay(now);
  if (spend.day !== day) Object.assign(spend, { day, base: 0, local: 0, readAt: Number.NEGATIVE_INFINITY });
  if (now - spend.readAt >= SPEND_REFRESH_MS) {
    spend.readAt = now;
    try {
      const stored = await total("global", day);
      spend.base = stored.cost;
      spend.local = 0;
    } catch {
      // Store down: keep counting this instance's own spend and say so once.
      reportStoreDown();
    }
  }
  const capMicro = (getLimits().dailyGlobalSpendCapUsd ?? DEFAULT_SPEND_CAP_USD) * 1_000_000;
  const reached = spend.base + spend.local >= capMicro;
  if (reached && spend.announcedDay !== day) {
    spend.announcedDay = day;
    createLogger({ requestId: "system", route: "ai/limits" }).warn("ai_spend_cap_reached", { capUsd: capMicro / 1_000_000 });
  }
  return reached;
}

/** Tests only: empty every counter and use a fake clock. */
export function resetLimitsForTest(now: () => number = Date.now): void {
  clock = now;
  memory.clear();
  downReportedAt = Number.NEGATIVE_INFINITY;
  Object.assign(spend, { day: "", base: 0, local: 0, readAt: Number.NEGATIVE_INFINITY, announcedDay: "" });
}
