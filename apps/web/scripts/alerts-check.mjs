// Reads the metric views and /api/ready, applies the rules in src/lib/telemetry/alerts.ts and writes alerts.json.
// Run by .github/workflows/alerts.yml: node --experimental-strip-types apps/web/scripts/alerts-check.mjs
// Needs SUPABASE_URL, SUPABASE_SECRET_KEY, APP_URL. Optional: AI_DAILY_GLOBAL_SPEND_CAP_USD. Prints alert keys only, never a value.
import { writeFileSync } from "node:fs";
import { DEFAULT_THRESHOLDS, evaluateAlerts } from "../src/lib/telemetry/alerts.ts";

const { SUPABASE_URL, SUPABASE_SECRET_KEY, APP_URL, AI_DAILY_GLOBAL_SPEND_CAP_USD, ALERTS_OUT = "alerts.json" } = process.env;
for (const [name, value] of Object.entries({ SUPABASE_URL, SUPABASE_SECRET_KEY, APP_URL })) {
  if (!value) {
    console.error(`missing configuration: ${name}`);
    process.exit(2);
  }
}

const TIMEOUT_MS = 10_000;
const cap = Number(AI_DAILY_GLOBAL_SPEND_CAP_USD);
const thresholds = { ...DEFAULT_THRESHOLDS, spendCapUsd: Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_THRESHOLDS.spendCapUsd };
const auth = { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` };

/** One REST read. Returns the first row, or null when anything goes wrong (the rule then raises metrics_unreachable). */
async function firstRow(path) {
  try {
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? (rows[0] ?? {}) : null;
  } catch {
    return null;
  }
}

async function readReady() {
  try {
    const res = await fetch(`${APP_URL.replace(/\/$/, "")}/api/ready`, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    const failed = Array.isArray(body?.failed) ? body.failed.filter((n) => typeof n === "string") : [];
    return { ok: res.ok && body?.ok === true, failed };
  } catch {
    return null;
  }
}

const count = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const [recentRow, spendRow, ready] = await Promise.all([firstRow("ops_v_ai_recent_30m?select=*"), firstRow("ops_v_usage_today?scope=eq.global&select=cost_usd"), readReady()]);

const alerts = evaluateAlerts(
  {
    recent: recentRow === null ? null : { calls: count(recentRow.calls), errorCalls: count(recentRow.error_calls), degradedCalls: count(recentRow.degraded_calls) },
    // No global row yet today means nothing was spent, not that the read failed.
    spendUsd: spendRow === null ? null : count(spendRow.cost_usd),
    ready,
  },
  thresholds,
);

writeFileSync(ALERTS_OUT, JSON.stringify(alerts, null, 2));
console.log(`alerts: ${alerts.length === 0 ? "none" : alerts.map((a) => a.key).join(", ")}`);
