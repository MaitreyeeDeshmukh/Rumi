/**
 * Alert rules for the scheduled job (.github/workflows/alerts.yml). Pure: numbers in, alerts out.
 * It has no imports on purpose: the job runs it with plain `node --experimental-strip-types`, with no install step.
 */

export interface AlertSnapshot {
  /** The last 30 minutes of ops_ai_events (view ops_v_ai_recent_30m). null when the metrics could not be read. */
  recent: { calls: number; errorCalls: number; degradedCalls: number } | null;
  /** Spend today in USD, global bucket (view ops_v_usage_today). null when it could not be read. */
  spendUsd: number | null;
  /** App events (server 5xx, client crashes) in the last 30 minutes, from ops_alert_snapshot(). null when unreadable. */
  appErrors: number | null;
  /** The answer of /api/ready. null when the request itself failed. */
  ready: { ok: boolean; failed: string[] } | null;
  /**
   * From ops_alert_snapshot(). For each of these, `undefined` means "not part of this evaluation" (rule skipped) and `null`
   * means "the snapshot did not carry it" (rule undecided: an open issue is not closed as cleared).
   * Latest cron run of each rumi-maint-* job, keyed by the part after the prefix (partitions, retention, prune, anon-purge, health).
   */
  maintenance?: Record<string, { status: string | null; at: string | null }> | null;
  /** Rows landed in a default partition, so a monthly partition is missing. */
  defaultPartitionRows?: boolean | null;
  /** The anon_purge_enabled flag. */
  anonPurgeEnabled?: boolean | null;
  /** Anonymous users the purge would delete (counted up to 100000). */
  anonymousBacklog?: number | null;
  /** The database clock (snapshot `at`) in ms, else the job's own. Used only to judge how old a maintenance run is. */
  nowMs?: number;
}

export interface AlertThresholds {
  /** Provider error share over 30 minutes. Default 0.10. */
  errorRate: number;
  /** Fallback (degraded) share over 30 minutes. Default 0.25. */
  degradedRate: number;
  /** Share of the daily cap. Default 0.8. */
  spendFraction: number;
  spendCapUsd: number;
  /** Fewer calls than this in the window is too little to judge, so a rate alert is not raised. Default 20. */
  minCalls: number;
  /** More app events than this in 30 minutes raises app_errors. Default 10. */
  appErrors: number;
  /** A maintenance job whose last run is older than this many hours is stale. Default 36 (they run daily). */
  maintenanceStaleHours: number;
  /** Anonymous-user backlog that raises while the purge is armed. Default 20000. */
  backlogArmed: number;
  /** Anonymous-user backlog that raises even while the purge is off. Default 50000. Between the two it is only informational. */
  backlogAlways: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  errorRate: 0.1,
  degradedRate: 0.25,
  spendFraction: 0.8,
  spendCapUsd: 10,
  minCalls: 20,
  appErrors: 10,
  maintenanceStaleHours: 36,
  backlogArmed: 20_000,
  backlogAlways: 50_000,
};

/** The five daily jobs scheduled by migration E, as ops_alert_snapshot() names them (jobname without "rumi-maint-"). */
export const MAINTENANCE_JOBS = ["partitions", "retention", "prune", "anon-purge", "health"] as const;

export interface Alert {
  /** Stable id. The issue title is "[alert] <key>". */
  key:
    | "provider_errors"
    | "degraded_replies"
    | "spend_cap"
    | "app_errors"
    | "not_ready"
    | "metrics_unreachable"
    | "maintenance_stale"
    | "default_partition_rows"
    | "anonymous_backlog";
  title: string;
  /** Numbers and dependency names only. */
  detail: string;
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const NAME = /^[a-z_]{1,20}$/;

export function evaluateAlerts(s: AlertSnapshot, t: AlertThresholds = DEFAULT_THRESHOLDS): Alert[] {
  const alerts: Alert[] = [];

  if (s.recent === null || s.spendUsd === null || s.appErrors === null) {
    alerts.push({
      key: "metrics_unreachable",
      title: "The alert job cannot read the metrics",
      detail: "The metric views did not answer. Alerts for error rate and spend are blind until this is fixed. Check the Supabase project and the alert secrets.",
    });
  }

  if (s.recent !== null && s.recent.calls >= t.minCalls) {
    const errorRate = s.recent.errorCalls / s.recent.calls;
    if (errorRate > t.errorRate) {
      alerts.push({
        key: "provider_errors",
        title: "AI provider error rate is high",
        detail: `${pct(errorRate)} of ${s.recent.calls} AI calls failed in the last 30 minutes (limit ${pct(t.errorRate)}). Follow the "Provider down" runbook.`,
      });
    }
    const degradedRate = s.recent.degradedCalls / s.recent.calls;
    if (degradedRate > t.degradedRate) {
      alerts.push({
        key: "degraded_replies",
        title: "Many replies are falling back",
        detail: `${pct(degradedRate)} of ${s.recent.calls} AI calls used the fallback in the last 30 minutes (limit ${pct(t.degradedRate)}). Follow the "Provider down" runbook.`,
      });
    }
  }

  if (s.spendUsd !== null && s.spendUsd > t.spendFraction * t.spendCapUsd) {
    alerts.push({
      key: "spend_cap",
      title: "AI spend is near the daily cap",
      detail: `Spend today is ${s.spendUsd.toFixed(2)} USD, over ${pct(t.spendFraction)} of the ${t.spendCapUsd.toFixed(2)} USD cap. Follow the "Cost spike" runbook.`,
    });
  }

  if (s.appErrors !== null && s.appErrors > t.appErrors) {
    alerts.push({
      key: "app_errors",
      title: "App errors are high",
      detail: `${s.appErrors} app error events in the last 30 minutes (limit ${t.appErrors}). Check ops_v_app_errors_daily by code and release. Follow the "Bad deploy" runbook if one release stands out.`,
    });
  }

  if (s.maintenance) {
    const now = s.nowMs ?? Date.now();
    const limitMs = t.maintenanceStaleHours * 3_600_000;
    const bad: string[] = [];
    for (const job of MAINTENANCE_JOBS) {
      const run = Object.hasOwn(s.maintenance, job) ? s.maintenance[job] : undefined;
      const at = run?.at ? Date.parse(run.at) : Number.NaN;
      if (run === undefined) bad.push(`${job} (not scheduled)`);
      else if (Number.isNaN(at)) bad.push(`${job} (never ran)`);
      else if (run.status === "failed") bad.push(`${job} (last run failed)`);
      else if (now - at > limitMs) bad.push(`${job} (last run ${Math.floor((now - at) / 3_600_000)} h ago)`);
    }
    if (bad.length > 0) {
      alerts.push({
        key: "maintenance_stale",
        title: "Database maintenance is not running",
        detail: `Jobs: ${bad.join(", ")}. Limit ${t.maintenanceStaleHours} h. Read cron.job_run_details for the failed job and follow the "Database maintenance" runbook.`,
      });
    }
  }

  if (s.defaultPartitionRows === true) {
    alerts.push({
      key: "default_partition_rows",
      title: "Rows are landing in a default partition",
      detail: 'ops_app_events or ops_ai_events has rows in its default partition, so a monthly partition is missing. Run public.ops_maint_partitions() and follow the "Database maintenance" runbook.',
    });
  }

  if (typeof s.anonymousBacklog === "number") {
    const limit = s.anonPurgeEnabled === true ? t.backlogArmed : t.backlogAlways;
    if (s.anonymousBacklog > limit) {
      alerts.push({
        key: "anonymous_backlog",
        title: "Anonymous users are piling up",
        detail: `${s.anonymousBacklog} anonymous users are old enough to purge (limit ${limit}, purge ${s.anonPurgeEnabled === true ? "on" : "off"}). Follow the "Database maintenance" runbook.`,
      });
    }
  }

  if (s.ready === null || !s.ready.ok) {
    const names = s.ready === null ? ["unreachable"] : s.ready.failed.filter((n) => NAME.test(n)).slice(0, 5);
    alerts.push({
      key: "not_ready",
      title: "The app is not ready",
      detail: `/api/ready failed. Failed: ${names.length > 0 ? names.join(", ") : "unknown"}. Follow the runbook for that dependency.`,
    });
  }

  return alerts;
}

/**
 * Alerts whose condition could not be judged this run: the metrics were unreadable, or a rate rule had fewer than
 * `minCalls` calls to go on. An open issue for one of these must NOT be closed as "cleared": no data is not good news.
 */
export function undecidedAlerts(s: AlertSnapshot, t: AlertThresholds = DEFAULT_THRESHOLDS): Alert["key"][] {
  const rateUnknown = s.recent === null || s.recent.calls < t.minCalls;
  const keys: Alert["key"][] = [];
  if (rateUnknown) keys.push("provider_errors", "degraded_replies");
  if (s.spendUsd === null) keys.push("spend_cap");
  if (s.appErrors === null) keys.push("app_errors");
  if (s.maintenance === null) keys.push("maintenance_stale");
  if (s.defaultPartitionRows === null) keys.push("default_partition_rows");
  if (s.anonymousBacklog === null) keys.push("anonymous_backlog");
  return keys;
}

/** Things worth a line in the job log but not an issue: a backlog above the armed limit while the purge is still off. */
export function informational(s: AlertSnapshot, t: AlertThresholds = DEFAULT_THRESHOLDS): string[] {
  const notes: string[] = [];
  if (typeof s.anonymousBacklog === "number" && s.anonPurgeEnabled !== true && s.anonymousBacklog > t.backlogArmed && s.anonymousBacklog <= t.backlogAlways) {
    notes.push(`anonymous_backlog ${s.anonymousBacklog} (purge off; review the anon_purge_dry_run count before arming it)`);
  }
  return notes;
}
