/**
 * Kill-switches from `ops_feature_flags` (08 sections 1.6 and 3). One query reads all three flags; the answer is kept
 * 30 s in memory. If the database fails the last known value is used, and with no value yet the default decides:
 * AI stays ON (fail open for availability, the fallbacks still protect users), cloud writes stay OFF (fail safe for data).
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { recordAppEvent } from "@/lib/telemetry/sinks";

export type FlagKey = "ai_enabled" | "memory_sync_enabled" | "cloud_sync_enabled";

const FLAG_DEFAULTS: Record<FlagKey, boolean> = { ai_enabled: true, memory_sync_enabled: false, cloud_sync_enabled: false };
const KEYS = Object.keys(FLAG_DEFAULTS) as FlagKey[];

const FLAG_TTL_MS = 30_000;
/** The database read gives up after this long, so a slow database cannot slow a request. */
const FLAG_READ_MS = 1_500;

type Values = Partial<Record<FlagKey, boolean>>;
let values: Values = {};
let loadedAt = Number.NEGATIVE_INFINITY;
let loading: Promise<void> | undefined;
let clock: () => number = Date.now;

async function read(): Promise<Values> {
  const query = Promise.resolve(getAdminClient().from("ops_feature_flags").select("key, enabled"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("flags timeout")), FLAG_READ_MS);
  });
  try {
    const { data, error } = await Promise.race([query, timeout]);
    if (error || !Array.isArray(data)) throw new Error("flags read failed");
    const next: Values = {};
    for (const row of data as Array<{ key?: unknown; enabled?: unknown }>) {
      if (typeof row.enabled === "boolean" && KEYS.includes(row.key as FlagKey)) next[row.key as FlagKey] = row.enabled;
    }
    return next;
  } finally {
    clearTimeout(timer);
  }
}

async function refresh(): Promise<void> {
  try {
    // A flag missing from the table keeps its previous value or default; only rows that came back are replaced.
    values = { ...values, ...(await read()) };
  } catch {
    // Database down or slow: keep the stale values (or defaults) and say so once per TTL, so a dead store is not hit on every request.
    recordAppEvent({ source: "server", area: "db", code: "flags_read_failed" });
  }
  loadedAt = clock();
}

export async function getFlag(key: FlagKey): Promise<boolean> {
  if (clock() - loadedAt >= FLAG_TTL_MS) {
    loading ??= refresh().finally(() => {
      loading = undefined;
    });
    await loading;
  }
  return values[key] ?? FLAG_DEFAULTS[key];
}

/** Tests only: forget cached values and use a fake clock. */
export function resetFlagsForTest(now: () => number = Date.now): void {
  values = {};
  loadedAt = Number.NEGATIVE_INFINITY;
  loading = undefined;
  clock = now;
}
