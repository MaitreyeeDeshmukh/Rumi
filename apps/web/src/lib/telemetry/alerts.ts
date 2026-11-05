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
}

export const DEFAULT_THRESHOLDS: AlertThresholds = { errorRate: 0.1, degradedRate: 0.25, spendFraction: 0.8, spendCapUsd: 10, minCalls: 20, appErrors: 10 };

export interface Alert {
  /** Stable id. The issue title is "[alert] <key>". */
  key: "provider_errors" | "degraded_replies" | "spend_cap" | "app_errors" | "not_ready" | "metrics_unreachable";
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
  return keys;
}
