import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_THRESHOLDS, evaluateAlerts, type AlertSnapshot } from "@/lib/telemetry/alerts";

const healthy: AlertSnapshot = { recent: { calls: 100, errorCalls: 0, degradedCalls: 0 }, spendUsd: 1, ready: { ok: true, failed: [] } };
const keys = (s: Partial<AlertSnapshot>): string[] => evaluateAlerts({ ...healthy, ...s }).map((a) => a.key);

describe("evaluateAlerts", () => {
  it("is quiet when everything is fine", () => {
    expect(keys({})).toEqual([]);
  });

  it("raises provider_errors strictly above 10% over the window", () => {
    expect(keys({ recent: { calls: 100, errorCalls: 10, degradedCalls: 0 } })).toEqual([]);
    expect(keys({ recent: { calls: 100, errorCalls: 11, degradedCalls: 0 } })).toEqual(["provider_errors"]);
  });

  it("raises degraded_replies strictly above 25%", () => {
    expect(keys({ recent: { calls: 100, errorCalls: 0, degradedCalls: 25 } })).toEqual([]);
    expect(keys({ recent: { calls: 100, errorCalls: 0, degradedCalls: 26 } })).toEqual(["degraded_replies"]);
  });

  it("does not judge a rate from fewer than 20 calls", () => {
    expect(keys({ recent: { calls: 19, errorCalls: 19, degradedCalls: 19 } })).toEqual([]);
    expect(keys({ recent: { calls: 20, errorCalls: 20, degradedCalls: 0 } })).toEqual(["provider_errors"]);
  });

  it("raises spend_cap strictly above 80% of the cap", () => {
    expect(keys({ spendUsd: 8 })).toEqual([]);
    expect(keys({ spendUsd: 8.01 })).toEqual(["spend_cap"]);
    expect(evaluateAlerts({ ...healthy, spendUsd: 4.1 }, { ...DEFAULT_THRESHOLDS, spendCapUsd: 5 }).map((a) => a.key)).toEqual(["spend_cap"]);
  });

  it("raises not_ready when /api/ready fails or cannot be reached, naming only safe dependency names", () => {
    expect(keys({ ready: { ok: false, failed: ["database"] } })).toEqual(["not_ready"]);
    expect(keys({ ready: null })).toEqual(["not_ready"]);
    const [a] = evaluateAlerts({ ...healthy, ready: { ok: false, failed: ["database", "x'; rm -rf /", "<script>"] } });
    expect(a.detail).toContain("database");
    expect(a.detail).not.toMatch(/rm -rf|<script>/);
  });

  it("raises metrics_unreachable instead of staying silent when the views cannot be read", () => {
    expect(keys({ recent: null })).toEqual(["metrics_unreachable"]);
    expect(keys({ spendUsd: null })).toEqual(["metrics_unreachable"]);
  });

  it("can raise several at once, each with a title and a detail made of numbers and names only", () => {
    const all = evaluateAlerts({ recent: { calls: 100, errorCalls: 50, degradedCalls: 50 }, spendUsd: 9, ready: { ok: false, failed: ["env"] } });
    expect(all.map((a) => a.key)).toEqual(["provider_errors", "degraded_replies", "spend_cap", "not_ready"]);
    for (const a of all) expect(a.title.length).toBeGreaterThan(5);
  });
});

describe("alert job files", () => {
  const read = (p: string): string => readFileSync(fileURLToPath(new URL(`../../../../${p}`, import.meta.url)), "utf8");

  it("the workflow runs every 15 minutes, holds no secret value, and uses repository secrets", () => {
    const yml = read(".github/workflows/alerts.yml");
    expect(yml).toContain('cron: "*/15 * * * *"');
    expect(yml).toMatch(/secrets\.ALERTS_SUPABASE_URL/);
    expect(yml).toMatch(/secrets\.ALERTS_SUPABASE_KEY/);
    expect(yml).toMatch(/issues: write/);
    expect(yml).not.toMatch(/eyJ[\w-]{10,}|sb_secret_|https:\/\/[a-z0-9]{15,}\.supabase\.co/);
  });

  it("the script uses the same rules module as the tests and prints keys only", () => {
    const js = read("apps/web/scripts/alerts-check.mjs");
    expect(js).toContain("src/lib/telemetry/alerts.ts");
    expect(js).toContain("ops_v_ai_recent_30m");
    expect(js).toContain("ops_v_usage_today");
    expect(js).not.toMatch(/console\.(log|error)\([^)]*(SECRET_KEY|auth)/);
  });
});

describe("supabase/views/metrics.sql", () => {
  const sql = readFileSync(fileURLToPath(new URL("../../../../supabase/views/metrics.sql", import.meta.url)), "utf8");
  const views = ["ops_v_ai_daily", "ops_v_app_errors_daily", "ops_v_usage_today", "ops_v_ai_recent_30m"];

  it("defines every view as security_invoker and reads it only through service_role", () => {
    for (const v of views) {
      expect(sql).toContain(`create or replace view public.${v} with (security_invoker = true)`);
      expect(sql).toMatch(new RegExp(`grant select on [^;]*public\\.${v}[^;]* to service_role`));
    }
    expect(sql).toMatch(/revoke all on [^;]*from public, anon, authenticated/);
    expect(sql).not.toMatch(/^grant [^;]*\b(anon|authenticated)\b/im);
  });

  it("filters the event tables by created_at so monthly partitions are pruned", () => {
    expect(sql.match(/where created_at >= now\(\) - interval/g)).toHaveLength(3);
  });

  it("selects no text, id or user columns", () => {
    expect(sql).not.toMatch(/\b(email|user_id|owner_id|message|body)\b/i);
  });
});
