import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bucketOf, checkAndBump, costMicroUsd, recordSpend, resetLimitsForTest, spendCapReached } from "@/lib/ai/limits";

type Rpc = { fn: string; args: Record<string, unknown> };

const mocks = vi.hoisted(() => ({
  down: false,
  hang: false,
  day: "",
  now: (): number => 0,
  calls: [] as Rpc[],
  rows: new Map<string, { calls: number; cost: number }>(),
  appEvents: [] as Array<{ code: string }>,
  warnings: [] as Array<{ event: string; f?: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    if (mocks.down) throw new Error("database is down");
    return {
      from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
      rpc: (fn: string, args: Record<string, unknown>) => {
        mocks.calls.push({ fn, args });
        // The real table is keyed by UTC day; the fake forgets its rows when the day changes.
        const today = new Date(mocks.now()).toISOString().slice(0, 10);
        if (mocks.day !== today) {
          mocks.day = today;
          mocks.rows.clear();
        }
        if (mocks.hang) return new Promise(() => undefined);
        const key = String(args.p_bucket);
        if (fn === "ops_bump_ai_usage") {
          const row = mocks.rows.get(key) ?? { calls: 0, cost: 0 };
          mocks.rows.set(key, { calls: row.calls + Number(args.p_calls), cost: row.cost + Number(args.p_cost_micro_usd) });
          return Promise.resolve({ data: null, error: null });
        }
        const row = mocks.rows.get(key) ?? { calls: 0, cost: 0 };
        return Promise.resolve({ data: [{ calls: row.calls, cost_micro_usd: row.cost }], error: null });
      },
    };
  },
}));
vi.mock("@/lib/telemetry/sinks", () => ({ recordAppEvent: (e: { code: string }) => mocks.appEvents.push(e), recordAiEvent: () => undefined }));
vi.mock("@/lib/log", () => ({
  createLogger: () => ({ info: () => undefined, error: () => undefined, warn: (event: string, f?: Record<string, unknown>) => mocks.warnings.push({ event, f }) }),
}));

const HOUR = 3_600_000;
// 2026-11-05 22:00:00 UTC: two hours to the next UTC day
const NOON = Date.UTC(2026, 10, 5, 22, 0, 0);
let t = NOON;
const USER = "0123456789abcdef0123456789abcdef";
const IP = "fedcba9876543210";

beforeEach(() => {
  t = NOON;
  mocks.down = false;
  mocks.hang = false;
  mocks.now = () => t;
  mocks.day = new Date(NOON).toISOString().slice(0, 10);
  mocks.calls.length = 0;
  mocks.rows.clear();
  mocks.appEvents.length = 0;
  mocks.warnings.length = 0;
  resetLimitsForTest(() => t);
  vi.stubEnv("AI_DAILY_USER_LIMIT", "3");
  vi.stubEnv("AI_DAILY_GLOBAL_SPEND_CAP_USD", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("buckets", () => {
  it("are u:<16 hex> for a user and ip:<8 hex> for an address, and never longer than the column", () => {
    expect(bucketOf(USER, IP)).toBe("u:0123456789abcdef");
    expect(bucketOf(null, IP)).toBe("ip:fedcba98");
  });
});

describe("checkAndBump with the store up", () => {
  it("counts a call against the user's bucket and the address bucket", async () => {
    expect(await checkAndBump({ userHash: USER, ipHash: IP, task: "plan" })).toEqual({ ok: true });
    const bumps = mocks.calls.filter((c) => c.fn === "ops_bump_ai_usage").map((c) => [c.args.p_bucket, c.args.p_calls, c.args.p_cost_micro_usd]);
    expect(bumps).toEqual(expect.arrayContaining([["u:0123456789abcdef", 1, 0], ["ip:fedcba98", 1, 0]]));
    expect(bumps).toHaveLength(2);
  });

  it("allows exactly AI_DAILY_USER_LIMIT calls for a user, then refuses with the seconds left until midnight UTC", async () => {
    for (let i = 0; i < 3; i++) expect(await checkAndBump({ userHash: USER, ipHash: IP, task: "plan" })).toEqual({ ok: true });
    expect(await checkAndBump({ userHash: USER, ipHash: IP, task: "plan" })).toEqual({ ok: false, retryAfterSec: 2 * 3600 });
  });

  it("a refused call is not counted", async () => {
    for (let i = 0; i < 4; i++) await checkAndBump({ userHash: USER, ipHash: IP, task: "plan" });
    expect(mocks.rows.get("u:0123456789abcdef")?.calls).toBe(3);
  });

  it("another user on the same address is not blocked by the first user's limit", async () => {
    for (let i = 0; i < 4; i++) await checkAndBump({ userHash: USER, ipHash: IP, task: "plan" });
    expect(await checkAndBump({ userHash: "b".repeat(32), ipHash: IP, task: "plan" })).toEqual({ ok: true });
  });

  it("a signed-in user's address allows five times the limit (shared Wi-Fi), then refuses everyone on it", async () => {
    for (let i = 0; i < 15; i++) expect(await checkAndBump({ userHash: `${i.toString(16).padEnd(32, "0")}`, ipHash: IP, task: "plan" })).toEqual({ ok: true });
    expect(await checkAndBump({ userHash: "c".repeat(32), ipHash: IP, task: "plan" })).toMatchObject({ ok: false });
  });

  it("a signed-out caller is limited by address alone at the plain limit", async () => {
    for (let i = 0; i < 3; i++) expect(await checkAndBump({ userHash: null, ipHash: IP, task: "sayit" })).toEqual({ ok: true });
    expect(await checkAndBump({ userHash: null, ipHash: IP, task: "sayit" })).toMatchObject({ ok: false });
    expect([...mocks.rows.keys()]).toEqual(["ip:fedcba98"]);
  });

  it("starts again on the next UTC day", async () => {
    for (let i = 0; i < 4; i++) await checkAndBump({ userHash: USER, ipHash: IP, task: "plan" });
    t += 3 * HOUR;
    expect(await checkAndBump({ userHash: USER, ipHash: IP, task: "plan" })).toEqual({ ok: true });
  });

  it("uses 60 calls a day when AI_DAILY_USER_LIMIT is not set", async () => {
    vi.stubEnv("AI_DAILY_USER_LIMIT", "");
    mocks.rows.set("u:0123456789abcdef", { calls: 59, cost: 0 });
    expect(await checkAndBump({ userHash: USER, ipHash: IP, task: "plan" })).toEqual({ ok: true });
    expect(await checkAndBump({ userHash: USER, ipHash: IP, task: "plan" })).toMatchObject({ ok: false });
  });
});

describe("checkAndBump with the store down: in-memory counter, one record, still served", () => {
  it("serves the request, counts in memory, and writes ONE usage_store_down app event for many failures", async () => {
    mocks.down = true;
    for (let i = 0; i < 3; i++) expect(await checkAndBump({ userHash: USER, ipHash: IP, task: "plan" })).toEqual({ ok: true });
    expect(mocks.appEvents).toEqual([{ source: "server", area: "ai", code: "usage_store_down" }]);
  });

  it("still enforces the daily limit from memory", async () => {
    mocks.down = true;
    for (let i = 0; i < 3; i++) await checkAndBump({ userHash: USER, ipHash: IP, task: "plan" });
    expect(await checkAndBump({ userHash: USER, ipHash: IP, task: "plan" })).toMatchObject({ ok: false });
  });

  it("says so again after five minutes of continued outage, not before", async () => {
    mocks.down = true;
    await checkAndBump({ userHash: USER, ipHash: IP, task: "plan" });
    t += 4 * 60_000;
    await checkAndBump({ userHash: "d".repeat(32), ipHash: "1111111111111111", task: "plan" });
    expect(mocks.appEvents).toHaveLength(1);
    t += 2 * 60_000;
    await checkAndBump({ userHash: "e".repeat(32), ipHash: "2222222222222222", task: "plan" });
    expect(mocks.appEvents).toHaveLength(2);
  });

  it("a store that answers with garbage counts as down", async () => {
    mocks.rows.set("u:0123456789abcdef", { calls: Number.NaN, cost: 0 });
    expect(await checkAndBump({ userHash: USER, ipHash: IP, task: "plan" })).toEqual({ ok: true });
    expect(mocks.appEvents).toHaveLength(1);
  });

  it("a store call that never answers is given up after 1.5 s, and the request is served from memory", async () => {
    vi.useFakeTimers();
    mocks.hang = true;
    const pending = checkAndBump({ userHash: USER, ipHash: IP, task: "plan" });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await pending).toEqual({ ok: true });
    expect(mocks.appEvents).toHaveLength(1);
  });
});

describe("costMicroUsd", () => {
  it("prices gpt-oss-120b at 0.15 in, 0.075 cached, 0.60 out per million tokens (micro-USD per token)", () => {
    expect(costMicroUsd("openai/gpt-oss-120b", 1000, 0, 1000)).toBe(750);
    expect(costMicroUsd("openai/gpt-oss-120b", 1000, 400, 0)).toBe(Math.ceil(600 * 0.15 + 400 * 0.075));
  });

  it("prices gpt-oss-20b at 0.075 in, 0.0375 cached, 0.30 out", () => {
    expect(costMicroUsd("openai/gpt-oss-20b", 1000, 0, 1000)).toBe(Math.ceil(75 + 300));
  });

  it("prices an unknown model as the larger one, so the cap errs on the safe side", () => {
    expect(costMicroUsd("some/other-model", 1000, 0, 1000)).toBe(costMicroUsd("openai/gpt-oss-120b", 1000, 0, 1000));
  });

  it("cannot go negative or count more cached tokens than input tokens", () => {
    expect(costMicroUsd("openai/gpt-oss-20b", -5, 10, -5)).toBe(0);
    expect(costMicroUsd("openai/gpt-oss-20b", 100, 500, 0)).toBe(costMicroUsd("openai/gpt-oss-20b", 100, 100, 0));
  });
});

describe("the global spend cap", () => {
  it("is not reached below the cap", async () => {
    expect(await spendCapReached()).toBe(false);
    recordSpend(999_999);
    expect(await spendCapReached()).toBe(false);
  });

  it("is reached once the day's spend hits AI_DAILY_GLOBAL_SPEND_CAP_USD, counting this instance's own spend at once", async () => {
    expect(await spendCapReached()).toBe(false);
    recordSpend(600_000);
    recordSpend(400_000);
    expect(await spendCapReached()).toBe(true);
  });

  it("writes each spend to the global bucket", async () => {
    recordSpend(1234);
    await Promise.resolve();
    expect(mocks.calls.filter((c) => c.fn === "ops_bump_ai_usage").map((c) => [c.args.p_bucket, c.args.p_cost_micro_usd])).toEqual([["global", 1234]]);
  });

  it("sees the spend other instances stored, within 30 s", async () => {
    mocks.rows.set("global", { calls: 10, cost: 1_000_000 });
    expect(await spendCapReached()).toBe(true);
  });

  it("logs once per day when it first trips, never a spend amount or a user", async () => {
    mocks.rows.set("global", { calls: 10, cost: 2_000_000 });
    for (let i = 0; i < 5; i++) await spendCapReached();
    expect(mocks.warnings).toEqual([{ event: "ai_spend_cap_reached", f: { capUsd: 1 } }]);
    t += 3 * HOUR; // next UTC day: the counter starts again and the cap is no longer reached
    expect(await spendCapReached()).toBe(false);
  });

  it("with the store down it counts this instance's own spend and still trips", async () => {
    mocks.down = true;
    expect(await spendCapReached()).toBe(false);
    recordSpend(1_000_000);
    expect(await spendCapReached()).toBe(true);
    expect(mocks.appEvents.some((e) => e.code === "usage_store_down")).toBe(true);
  });

  it("defaults to 10 USD when the variable is not set", async () => {
    vi.stubEnv("AI_DAILY_GLOBAL_SPEND_CAP_USD", "");
    mocks.rows.set("global", { calls: 1, cost: 9_999_999 });
    expect(await spendCapReached()).toBe(false);
    recordSpend(1);
    expect(await spendCapReached()).toBe(true);
  });
});
