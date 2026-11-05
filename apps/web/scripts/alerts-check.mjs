// Reads ops_alert_snapshot() and /api/ready, applies the rules in src/lib/telemetry/alerts.ts and writes alerts.json:
//   { "alerts": [...], "undecided": [...] }   (undecided = rules that had no data this run; see alertIssues.ts)
// Run by .github/workflows/alerts.yml: node --experimental-strip-types apps/web/scripts/alerts-check.mjs
// Needs SUPABASE_URL, SUPABASE_SECRET_KEY, APP_URL. Optional: READY_TOKEN (to learn WHICH dependency failed),
// AI_DAILY_GLOBAL_SPEND_CAP_USD, READY_RETRY_MS (default 5000), ALERTS_OUT.
// A missing variable or an unreachable service is itself an alert (metrics_unreachable / not_ready), written to the file
// with exit 0, so an issue opens. Exit 1 happens only on a bug in this script. Prints alert keys only, never a value.
import { writeFileSync } from "node:fs";
import { DEFAULT_THRESHOLDS, evaluateAlerts, informational, undecidedAlerts } from "../src/lib/telemetry/alerts.ts";

const { SUPABASE_URL, SUPABASE_SECRET_KEY, APP_URL, READY_TOKEN, AI_DAILY_GLOBAL_SPEND_CAP_USD, ALERTS_OUT = "alerts.json" } = process.env;
const TIMEOUT_MS = 10_000;
const RETRY_MS = Number.isFinite(Number(process.env.READY_RETRY_MS)) ? Number(process.env.READY_RETRY_MS) : 5000;

const cap = Number(AI_DAILY_GLOBAL_SPEND_CAP_USD);
const thresholds = { ...DEFAULT_THRESHOLDS, spendCapUsd: Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_THRESHOLDS.spendCapUsd };

/** https only (plain http just for a local mock), so the service key is never sent in clear text. null for anything else. */
function baseUrl(value) {
  try {
    const u = new URL(value ?? "");
    const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
    return u.protocol === "https:" || (u.protocol === "http:" && local) ? u.origin : null;
  } catch {
    return null;
  }
}

// redirect: "error" - a redirect would carry the service key and token to another host.
const get = (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });

/** The snapshot JSON, or null when anything goes wrong (the rules then raise metrics_unreachable). */
async function readSnapshot() {
  const base = baseUrl(SUPABASE_URL);
  if (base === null || !SUPABASE_SECRET_KEY) return null;
  try {
    const res = await get(`${base}/rest/v1/rpc/ops_alert_snapshot`, {
      method: "POST",
      headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body === "object" && body !== null ? body : null;
  } catch {
    return null;
  }
}

async function probeReady(base) {
  try {
    const res = await get(`${base}/api/ready`, READY_TOKEN ? { headers: { "x-ready-token": READY_TOKEN } } : {});
    const body = await res.json().catch(() => ({}));
    const failed = Array.isArray(body?.failed) ? body.failed.filter((n) => typeof n === "string") : [];
    return { ok: res.ok && body?.ok === true, failed };
  } catch {
    return null;
  }
}

/** Two probes: the second runs only after a failed first one, RETRY_MS later. One blip (a deploy, a cold start) is not an alert. */
async function readReady() {
  const base = baseUrl(APP_URL);
  if (base === null) return null;
  const first = await probeReady(base);
  if (first?.ok) return first;
  await new Promise((r) => setTimeout(r, RETRY_MS));
  return probeReady(base);
}

/** Fields added by the A-E migrations. null (not undefined) when the snapshot lacks one or has the wrong type: the rule is then undecided. */
function newFields(snap) {
  if (snap === null) return { maintenance: null, defaultPartitionRows: null, anonPurgeEnabled: null, anonymousBacklog: null };
  const m = snap.last_maintenance;
  const maintenance =
    typeof m === "object" && m !== null && !Array.isArray(m)
      ? Object.fromEntries(Object.entries(m).map(([job, v]) => [job, { status: typeof v?.status === "string" ? v.status : null, at: typeof v?.at === "string" ? v.at : null }]))
      : null;
  const at = Date.parse(snap.at);
  const backlog = snap.anonymous_user_backlog;
  return {
    maintenance,
    defaultPartitionRows: typeof snap.default_partition_rows === "boolean" ? snap.default_partition_rows : null,
    anonPurgeEnabled: typeof snap.anon_purge_enabled === "boolean" ? snap.anon_purge_enabled : null,
    anonymousBacklog: backlog !== null && backlog !== undefined && Number.isFinite(Number(backlog)) ? Number(backlog) : null,
    nowMs: Number.isNaN(at) ? Date.now() : at,
  };
}

const count = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const [snap, ready] = await Promise.all([readSnapshot(), readReady()]);

const ai = snap?.ai_30m;
const appEvents = snap?.app_events_30m;
const snapshot = {
  recent: snap === null || typeof ai !== "object" || ai === null ? null : { calls: count(ai.calls), errorCalls: count(ai.error_calls), degradedCalls: count(ai.degraded_calls) },
  // No global usage row yet today means nothing was spent (the function returns 0), not that the read failed.
  spendUsd: snap === null || typeof snap.usage_today !== "object" || snap.usage_today === null ? null : count(snap.usage_today.global_cost_usd),
  appErrors: snap === null || typeof appEvents !== "object" || appEvents === null ? null : Object.values(appEvents).reduce((sum, n) => sum + count(n), 0),
  ready,
  ...newFields(snap),
};

const result = { alerts: evaluateAlerts(snapshot, thresholds), undecided: undecidedAlerts(snapshot, thresholds) };
writeFileSync(ALERTS_OUT, JSON.stringify(result, null, 2));
console.log(`alerts: ${result.alerts.length === 0 ? "none" : result.alerts.map((a) => a.key).join(", ")}; undecided: ${result.undecided.join(", ") || "none"}`);
for (const note of informational(snapshot, thresholds)) console.log(`info: ${note}`);
