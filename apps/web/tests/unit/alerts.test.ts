import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_THRESHOLDS, MAINTENANCE_JOBS, evaluateAlerts, informational, undecidedAlerts, type AlertSnapshot } from "@/lib/telemetry/alerts";
import { CLEARED_COMMENT, NO_DATA_COMMENT, syncIssues, type Gh } from "@/lib/telemetry/alertIssues";

const healthy: AlertSnapshot = { recent: { calls: 100, errorCalls: 0, degradedCalls: 0 }, spendUsd: 1, appErrors: 0, ready: { ok: true, failed: [] } };
const keys = (s: Partial<AlertSnapshot>): string[] => evaluateAlerts({ ...healthy, ...s }).map((a) => a.key);

const NOW = Date.parse("2026-11-06T12:00:00Z");
const HOUR = 3_600_000;
const ranAt = (hoursAgo: number, status = "succeeded") => ({ status, at: new Date(NOW - hoursAgo * HOUR).toISOString() });
/** All five jobs ran 9 hours ago and succeeded. */
const freshJobs = () => Object.fromEntries(MAINTENANCE_JOBS.map((j) => [j, ranAt(9)]));
const db = (s: Partial<AlertSnapshot>): string[] =>
  evaluateAlerts({ ...healthy, nowMs: NOW, maintenance: freshJobs(), defaultPartitionRows: false, anonPurgeEnabled: false, anonymousBacklog: 0, ...s }).map((a) => a.key);

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

  it("raises app_errors strictly above 10 events in 30 minutes", () => {
    expect(keys({ appErrors: 10 })).toEqual([]);
    expect(keys({ appErrors: 11 })).toEqual(["app_errors"]);
  });

  it("raises not_ready when /api/ready fails or cannot be reached, naming only safe dependency names", () => {
    expect(keys({ ready: { ok: false, failed: ["database"] } })).toEqual(["not_ready"]);
    expect(keys({ ready: null })).toEqual(["not_ready"]);
    const [a] = evaluateAlerts({ ...healthy, ready: { ok: false, failed: ["database", "x'; rm -rf /", "<script>"] } });
    expect(a.detail).toContain("database");
    expect(a.detail).not.toMatch(/rm -rf|<script>/);
  });

  it("raises metrics_unreachable instead of staying silent when the metrics cannot be read", () => {
    expect(keys({ recent: null })).toEqual(["metrics_unreachable"]);
    expect(keys({ spendUsd: null })).toEqual(["metrics_unreachable"]);
    expect(keys({ appErrors: null })).toEqual(["metrics_unreachable"]);
  });

  it("can raise several at once, each with a title and a detail made of numbers and names only", () => {
    const all = evaluateAlerts({ recent: { calls: 100, errorCalls: 50, degradedCalls: 50 }, spendUsd: 9, appErrors: 50, ready: { ok: false, failed: ["env"] } });
    expect(all.map((a) => a.key)).toEqual(["provider_errors", "degraded_replies", "spend_cap", "app_errors", "not_ready"]);
    for (const a of all) expect(a.title.length).toBeGreaterThan(5);
  });
});

describe("evaluateAlerts: database maintenance (ops_alert_snapshot from migrations A-E)", () => {
  it("is quiet when every job ran within 36 hours and succeeded", () => {
    expect(db({})).toEqual([]);
    expect(db({ maintenance: Object.fromEntries(MAINTENANCE_JOBS.map((j) => [j, ranAt(36)])) })).toEqual([]); // exactly at the limit is fine
  });

  it("raises maintenance_stale for a job older than 36 hours, one that never ran, one that is missing, and one that failed", () => {
    expect(db({ maintenance: { ...freshJobs(), prune: ranAt(37) } })).toEqual(["maintenance_stale"]);
    expect(db({ maintenance: { ...freshJobs(), prune: { status: null, at: null } } })).toEqual(["maintenance_stale"]);
    const fewer: Record<string, { status: string; at: string }> = freshJobs();
    delete fewer.health;
    expect(db({ maintenance: fewer })).toEqual(["maintenance_stale"]);
    expect(db({ maintenance: { ...freshJobs(), retention: ranAt(1, "failed") } })).toEqual(["maintenance_stale"]);
    expect(db({ maintenance: {} })).toEqual(["maintenance_stale"]);
  });

  it("names the jobs and the reason in the detail, and nothing else", () => {
    const a = evaluateAlerts({ ...healthy, nowMs: NOW, maintenance: { ...freshJobs(), prune: ranAt(40), health: ranAt(2, "failed") } }).find((x) => x.key === "maintenance_stale");
    expect(a?.detail).toContain("prune (last run 40 h ago)");
    expect(a?.detail).toContain("health (last run failed)");
    expect(a?.detail).not.toContain("partitions");
  });

  it("a job that is still running is not a failure", () => {
    expect(db({ maintenance: { ...freshJobs(), partitions: ranAt(0, "running") } })).toEqual([]);
  });

  it("raises default_partition_rows when rows sit in a default partition", () => {
    expect(db({ defaultPartitionRows: true })).toEqual(["default_partition_rows"]);
  });

  it("anonymous backlog: informational between 20000 and 50000 while the purge is off, an alert above 50000, an alert above 20000 once armed", () => {
    expect(db({ anonymousBacklog: 20_001 })).toEqual([]);
    expect(informational({ ...healthy, anonPurgeEnabled: false, anonymousBacklog: 20_001 })).toHaveLength(1);
    expect(db({ anonymousBacklog: 50_000 })).toEqual([]);
    expect(db({ anonymousBacklog: 50_001 })).toEqual(["anonymous_backlog"]);
    expect(db({ anonPurgeEnabled: true, anonymousBacklog: 20_000 })).toEqual([]);
    expect(db({ anonPurgeEnabled: true, anonymousBacklog: 20_001 })).toEqual(["anonymous_backlog"]);
    expect(informational({ ...healthy, anonPurgeEnabled: true, anonymousBacklog: 30_000 })).toEqual([]);
  });

  it("skips these rules when the snapshot does not carry them (undefined), and leaves them undecided when it lacks them (null)", () => {
    expect(keys({})).toEqual([]);
    expect(undecidedAlerts({ ...healthy, maintenance: null, defaultPartitionRows: null, anonymousBacklog: null })).toEqual(["maintenance_stale", "default_partition_rows", "anonymous_backlog"]);
    expect(undecidedAlerts({ ...healthy, maintenance: freshJobs(), defaultPartitionRows: false, anonymousBacklog: 0 })).toEqual([]);
  });
});

describe("undecidedAlerts", () => {
  it("is empty when there is enough data", () => {
    expect(undecidedAlerts(healthy)).toEqual([]);
  });

  it("marks the two rate rules undecided when fewer than 20 calls, and each metric rule when its input is unreadable", () => {
    expect(undecidedAlerts({ ...healthy, recent: { calls: 3, errorCalls: 0, degradedCalls: 0 } })).toEqual(["provider_errors", "degraded_replies"]);
    expect(undecidedAlerts({ ...healthy, recent: null, spendUsd: null, appErrors: null })).toEqual(["provider_errors", "degraded_replies", "spend_cap", "app_errors"]);
  });
});

function fakeGh(open: { number: number; title: string }[], lastComment = ""): { gh: Gh; calls: string[] } {
  const calls: string[] = [];
  const gh: Gh = {
    listOpen: () => open,
    create: (t) => void calls.push(`create ${t}`),
    edit: (n) => void calls.push(`edit ${n}`),
    close: (n, c) => void calls.push(`close ${n} ${c}`),
    lastComment: () => lastComment,
    comment: (n, b) => void calls.push(`comment ${n} ${b}`),
  };
  return { gh, calls };
}
const alert = (key: string) => ({ key, title: key, detail: "d" });

describe("syncIssues", () => {
  it("opens an issue for a new alert and updates the one that is already open", () => {
    const { gh, calls } = fakeGh([{ number: 7, title: "[alert] spend_cap" }]);
    syncIssues({ alerts: [alert("spend_cap"), alert("not_ready")], undecided: [] }, gh);
    expect(calls).toEqual(["edit 7", "create [alert] not_ready"]);
  });

  it("closes an issue whose alert is gone as cleared", () => {
    const { gh, calls } = fakeGh([{ number: 7, title: "[alert] not_ready" }]);
    syncIssues({ alerts: [], undecided: [] }, gh);
    expect(calls).toEqual([`close 7 ${CLEARED_COMMENT}`]);
  });

  it("keeps an issue open with a 'no data' comment when its alert could not be judged, and comments only once", () => {
    const open = [{ number: 7, title: "[alert] provider_errors" }];
    const first = fakeGh(open);
    syncIssues({ alerts: [], undecided: ["provider_errors", "degraded_replies"] }, first.gh);
    expect(first.calls).toEqual([`comment 7 ${NO_DATA_COMMENT}`]);
    const again = fakeGh(open, NO_DATA_COMMENT);
    syncIssues({ alerts: [], undecided: ["provider_errors"] }, again.gh);
    expect(again.calls).toEqual([]);
  });

  it("an undecided alert that is still firing is just updated; unrelated issues are never touched", () => {
    const { gh, calls } = fakeGh([
      { number: 1, title: "[alert] provider_errors" },
      { number: 2, title: "something else" },
    ]);
    syncIssues({ alerts: [alert("provider_errors")], undecided: ["provider_errors"] }, gh);
    expect(calls).toEqual(["edit 1"]);
  });
});

const root = (p: string): string => fileURLToPath(new URL(`../../../../${p}`, import.meta.url));

describe("alert workflow file", () => {
  const yml = readFileSync(root(".github/workflows/alerts.yml"), "utf8");

  it("runs every 15 minutes and uses the alerts environment and secrets, no secret value in the file", () => {
    expect(yml).toContain('cron: "*/15 * * * *"');
    expect(yml).toMatch(/environment: alerts/);
    for (const s of ["ALERTS_SUPABASE_URL", "ALERTS_SUPABASE_KEY", "ALERTS_APP_URL", "ALERTS_READY_TOKEN"]) expect(yml).toContain(`secrets.${s}`);
    expect(yml).toMatch(/issues: write/);
    expect(yml).not.toMatch(/eyJ[\w-]{10,}|sb_secret_|https:\/\/[a-z0-9]{15,}\.supabase\.co/);
  });

  it("pins every action to a full commit SHA and does not keep the git credentials", () => {
    const uses = yml.match(/^\s*- uses: \S+/gm) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
    expect(yml).toMatch(/persist-credentials: false/);
  });
});

describe("alerts-check.mjs", () => {
  const script = root("apps/web/scripts/alerts-check.mjs");
  const dirs: string[] = [];
  const servers: Server[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    for (const s of servers.splice(0)) s.close();
  });
  const outFile = (): string => {
    const d = mkdtempSync(join(tmpdir(), "alerts-"));
    dirs.push(d);
    return join(d, "alerts.json");
  };
  const cleanEnv: Record<string, string> = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", READY_RETRY_MS: "10" };
  const envOf = (env: Record<string, string>, out: string): NodeJS.ProcessEnv => ({ ...cleanEnv, ...env, ALERTS_OUT: out }) as unknown as NodeJS.ProcessEnv;
  const run = (env: Record<string, string>, out: string): string =>
    execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script], { env: envOf(env, out), encoding: "utf8", timeout: 30_000 });
  const read = (out: string): { alerts: { key: string; detail: string }[]; undecided: string[] } => JSON.parse(readFileSync(out, "utf8"));

  it("with nothing configured still writes alerts.json (metrics_unreachable, not_ready) and exits 0, so an issue opens", () => {
    const out = outFile();
    const printed = run({}, out);
    const r = read(out);
    expect(r.alerts.map((a) => a.key)).toEqual(["metrics_unreachable", "not_ready"]);
    expect(r.undecided).toEqual(["provider_errors", "degraded_replies", "spend_cap", "app_errors", "maintenance_stale", "default_partition_rows", "anonymous_backlog"]);
    expect(printed).toContain("metrics_unreachable");
  });

  it("refuses a plain http or non-url address and never sends the key there", () => {
    const out = outFile();
    run({ SUPABASE_URL: "http://example.com", SUPABASE_SECRET_KEY: "secretvalue", APP_URL: "ftp://example.com" }, out);
    expect(read(out).alerts.map((a) => a.key)).toEqual(["metrics_unreachable", "not_ready"]);
  });

  async function mock(handler: (url: string, headers: Record<string, string | string[] | undefined>, n: number) => { status: number; body: unknown; location?: string }): Promise<{ url: string; seen: string[] }> {
    const seen: string[] = [];
    let n = 0;
    const srv = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      const r = handler(req.url ?? "", req.headers, ++n);
      res.writeHead(r.status, { "content-type": "application/json", ...(r.location ? { location: r.location } : {}) });
      res.end(JSON.stringify(r.body));
    });
    servers.push(srv);
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
    const addr = srv.address();
    return { url: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`, seen };
  }
  // execFileSync would block this process's event loop and starve the mock server, so the script runs as a child process here.
  const runAsync = (env: Record<string, string>, out: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const child: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", script], { env: envOf(env, out), stdio: "ignore" });
      child.on("exit", (code: number | null) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
      child.on("error", reject);
    });

  const nowIso = new Date().toISOString();
  /** The shape of ops_alert_snapshot() from migration 20261105130000. */
  const snapshot = {
    at: nowIso,
    ai_30m: { calls: 100, error_calls: 30, degraded_calls: 5 },
    usage_today: { global_calls: 5, global_cost_usd: 9.5 },
    app_events_30m: { app: 8, auth: 5 },
    default_partition_rows: false,
    last_maintenance: Object.fromEntries(MAINTENANCE_JOBS.map((j) => [j, { status: "succeeded", at: nowIso }])),
    anon_purge_enabled: false,
    anonymous_user_backlog: 0,
  };

  it("reads ops_alert_snapshot() and /api/ready, and raises the matching alerts", async () => {
    const m = await mock((url) => (url.startsWith("/rest/v1/rpc/ops_alert_snapshot") ? { status: 200, body: snapshot } : { status: 200, body: { ok: true } }));
    const out = outFile();
    await runAsync({ SUPABASE_URL: m.url, SUPABASE_SECRET_KEY: "k", APP_URL: m.url, AI_DAILY_GLOBAL_SPEND_CAP_USD: "10" }, out);
    const r = read(out);
    expect(r.alerts.map((a) => a.key)).toEqual(["provider_errors", "spend_cap", "app_errors"]);
    expect(r.undecided).toEqual([]);
    expect(m.seen).toContain("POST /rest/v1/rpc/ops_alert_snapshot");
  });

  it("raises the database maintenance alerts from the snapshot, and prints an informational note without raising", async () => {
    const stale = new Date(Date.now() - 40 * HOUR).toISOString();
    const bad = { ...snapshot, ai_30m: { calls: 100, error_calls: 0, degraded_calls: 0 }, usage_today: { global_cost_usd: 1 }, app_events_30m: {}, default_partition_rows: true, last_maintenance: { ...snapshot.last_maintenance, prune: { status: "succeeded", at: stale } }, anonymous_user_backlog: 60_000 };
    const m = await mock((url) => (url.startsWith("/rest/v1/") ? { status: 200, body: bad } : { status: 200, body: { ok: true } }));
    const out = outFile();
    await runAsync({ SUPABASE_URL: m.url, SUPABASE_SECRET_KEY: "k", APP_URL: m.url }, out);
    expect(read(out).alerts.map((a) => a.key)).toEqual(["maintenance_stale", "default_partition_rows", "anonymous_backlog"]);

    const quiet = await mock((url) => (url.startsWith("/rest/v1/") ? { status: 200, body: { ...bad, default_partition_rows: false, last_maintenance: snapshot.last_maintenance, anonymous_user_backlog: 30_000 } } : { status: 200, body: { ok: true } }));
    const out2 = outFile();
    await runAsync({ SUPABASE_URL: quiet.url, SUPABASE_SECRET_KEY: "k", APP_URL: quiet.url }, out2);
    expect(read(out2)).toEqual({ alerts: [], undecided: [] });
  });

  it("an old snapshot without the new fields leaves those three rules undecided instead of passing them", async () => {
    const old: Record<string, unknown> = { ...snapshot };
    for (const k of ["last_maintenance", "default_partition_rows", "anon_purge_enabled", "anonymous_user_backlog"]) delete old[k];
    const m = await mock((url) => (url.startsWith("/rest/v1/") ? { status: 200, body: { ...old, ai_30m: { calls: 100, error_calls: 0, degraded_calls: 0 }, usage_today: { global_cost_usd: 1 }, app_events_30m: {} } } : { status: 200, body: { ok: true } }));
    const out = outFile();
    await runAsync({ SUPABASE_URL: m.url, SUPABASE_SECRET_KEY: "k", APP_URL: m.url }, out);
    expect(read(out)).toEqual({ alerts: [], undecided: ["maintenance_stale", "default_partition_rows", "anonymous_backlog"] });
  });

  it("raises not_ready only after two failed probes, and a single blip is not an alert", async () => {
    const calls: number[] = [];
    const flaky = await mock((url, _h, n) => {
      if (url.startsWith("/rest/v1/")) return { status: 200, body: { ...snapshot, ai_30m: { calls: 100, error_calls: 0, degraded_calls: 0 }, usage_today: { global_cost_usd: 1 }, app_events_30m: {} } };
      calls.push(n);
      return calls.length === 1 ? { status: 503, body: { ok: false } } : { status: 200, body: { ok: true } };
    });
    const out = outFile();
    await runAsync({ SUPABASE_URL: flaky.url, SUPABASE_SECRET_KEY: "k", APP_URL: flaky.url, READY_RETRY_MS: "10" }, out);
    expect(read(out).alerts).toEqual([]);
    expect(calls).toHaveLength(2); // the failed probe was retried

    const down = await mock((url) => (url.startsWith("/rest/v1/") ? { status: 200, body: { ...snapshot, ai_30m: { calls: 100, error_calls: 0, degraded_calls: 0 }, usage_today: { global_cost_usd: 1 }, app_events_30m: {} } } : { status: 503, body: { ok: false, failed: ["database", "<x>"] } }));
    const out2 = outFile();
    await runAsync({ SUPABASE_URL: down.url, SUPABASE_SECRET_KEY: "k", APP_URL: down.url, READY_TOKEN: "t", READY_RETRY_MS: "10" }, out2);
    const r = read(out2);
    expect(r.alerts.map((a) => a.key)).toEqual(["not_ready"]);
    expect(r.alerts[0].detail).toContain("database");
    expect(r.alerts[0].detail).not.toContain("<x>");
  });

  it("sends the ready token header only when configured", async () => {
    const heads: (string | string[] | undefined)[] = [];
    const m = await mock((url, h) => {
      if (!url.startsWith("/rest/v1/")) heads.push(h["x-ready-token"]);
      return { status: 200, body: url.startsWith("/rest/v1/") ? snapshot : { ok: true } };
    });
    await runAsync({ SUPABASE_URL: m.url, SUPABASE_SECRET_KEY: "k", APP_URL: m.url, READY_TOKEN: "tok" }, outFile());
    await runAsync({ SUPABASE_URL: m.url, SUPABASE_SECRET_KEY: "k", APP_URL: m.url }, outFile());
    expect(heads).toEqual(["tok", undefined]);
  });

  it("does not follow a redirect with the service key: the read fails instead", async () => {
    const target = await mock(() => ({ status: 200, body: snapshot }));
    const redirector = await mock(() => ({ status: 302, body: {}, location: `${target.url}/stolen` }));
    const out = outFile();
    await runAsync({ SUPABASE_URL: redirector.url, SUPABASE_SECRET_KEY: "k", APP_URL: redirector.url }, out);
    expect(target.seen).toEqual([]);
    expect(read(out).alerts.map((a) => a.key)).toContain("metrics_unreachable");
  });
});

describe("supabase/migrations/20261105130000_rumi_metric_views.sql (the one source of the metric views)", () => {
  const sql = readFileSync(root("supabase/migrations/20261105130000_rumi_metric_views.sql"), "utf8");
  const views = ["ops_v_ai_daily", "ops_v_app_errors_daily", "ops_v_usage_today", "ops_v_ai_recent_30m"];

  it("defines every view as security_invoker and reads it only through service_role", () => {
    for (const v of views) {
      expect(sql).toContain(`create or replace view public.${v} with (security_invoker = true)`);
      expect(sql).toMatch(new RegExp(`grant select on [^;]*public\\.${v}[^;]* to service_role`));
    }
    expect(sql).toMatch(/revoke all on [^;]*from public, anon, authenticated/);
    expect(sql).not.toMatch(/^grant [^;]*\b(anon|authenticated)\b/im);
  });

  it("defines ops_alert_snapshot() for service_role only", () => {
    expect(sql).toContain("create or replace function public.ops_alert_snapshot()");
    expect(sql).toMatch(/revoke execute on function public\.ops_alert_snapshot\(\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant\s+execute on function public\.ops_alert_snapshot\(\) to service_role/);
  });

  it("filters the event tables by created_at so monthly partitions are pruned", () => {
    expect(sql.match(/where created_at >= now\(\) - interval/g)).toHaveLength(4); // three views and ops_alert_snapshot
  });

  it("selects no text, id or user columns", () => {
    expect(sql).not.toMatch(/\b(email|user_id|owner_id|message|body)\b/i);
  });
});
