import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bucketOf, checkAndBump, costMicroUsd, recordSpend, resetLimitsForTest, spendCapReached } from "@/lib/ai/limits";

type Rpc = { fn: string; args: Record<string, unknown> };

const mocks = vi.hoisted(() => ({
  down: false,
  hang: false,
  /** "ok" | "missing" (function does not exist) | "garbage" (answers with something that is not a boolean) */
  take: "ok" as "ok" | "missing" | "garbage",
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
        if (mocks.hang) return new Promise(() => undefined);
        // The real table is keyed by UTC day; the fake forgets its rows when the day changes.
        const today = new Date(mocks.now()).toISOString().slice(0, 10);
        if (mocks.day !== today) {
          mocks.day = today;
          mocks.rows.clear();
        }
        if (fn === "ops_take_ai_quota") {
          if (mocks.take === "missing") return Promise.resolve({ data: null, error: { code: "42883", message: "function does not exist" } });
          if (mocks.take === "garbage") return Promise.resolve({ data: "yes", error: null });
          // Atomic like the SQL function: refuse if ANY bucket is at its limit, otherwise count them ALL.
          const names = args.p_buckets as string[];
          const limits = args.p_limits as number[];
          const full = names.some((n, i) => (mocks.rows.get(n)?.calls ?? 0) >= limits[i]);
          if (full) return Promise.resolve({ data: false, error: null });
          for (const n of names) {
            const row = mocks.rows.get(n) ?? { calls: 0, cost: 0 };
            mocks.rows.set(n, { calls: row.calls + 1, cost: row.cost });
          }
          return Promise.resolve({ data: true, error: null });
        }
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
const IP_BUCKET = "ip:fedcba98";
const USER_BUCKET = "u:0123456789abcdef";

const asUser = { userHash: USER, isAnonymous: false, ipHash: IP, task: "plan" } as const;
const asAnon = { userHash: USER, isAnonymous: true, ipHash: IP, task: "plan" } as const;
const signedOut = { userHash: null, isAnonymous: true, ipHash: IP, task: "plan" } as const;
const takes = (): Rpc[] => mocks.calls.filter((c) => c.fn === "ops_take_ai_quota");

beforeEach(() => {
  t = NOON;
  mocks.down = false;
  mocks.hang = false;
  mocks.take = "ok";
  mocks.now = () => t;
  mocks.day = new Date(NOON).toISOString().slice(0, 10);
  mocks.calls.length = 0;
  mocks.rows.clear();
  mocks.appEvents.length = 0;
  mocks.warnings.length = 0;
  resetLimitsForTest(() => t);
  vi.stubEnv("AI_DAILY_USER_LIMIT", "3");
  vi.stubEnv("AI_DAILY_ANON_LIMIT", "2");
  vi.stubEnv("AI_DAILY_GLOBAL_SPEND_CAP_USD", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("buckets", () => {
  it("are u:<16 hex> for a user and ip:<8 hex> for an address, and never longer than the column", () => {
    expect(bucketOf(USER, IP)).toBe(USER_BUCKET);
    expect(bucketOf(null, IP)).toBe(IP_BUCKET);
  });
});

describe("checkAndBump asks the store once, atomically (ops_take_ai_quota)", () => {
  it("is one rpc call, with the buckets sorted and each limit beside its bucket", async () => {
    expect(await checkAndBump(asUser)).toEqual({ ok: true });
    expect(mocks.calls).toHaveLength(1);
    expect(takes()[0].args).toEqual({ p_buckets: [IP_BUCKET, USER_BUCKET], p_limits: [15, 3] });
  });

  it("a signed-in (email) user's address allows five times the limit", async () => {
    await checkAndBump(asUser);
    expect(takes()[0].args.p_limits).toEqual([15, 3]);
  });

  it("an anonymous user gets the smaller user limit and only the plain limit for the address", async () => {
    await checkAndBump(asAnon);
    expect(takes()[0].args).toEqual({ p_buckets: [IP_BUCKET, USER_BUCKET], p_limits: [3, 2] });
  });

  it("anonymous defaults: 20 a day for the user, 60 for the address; the anonymous limit never exceeds the user limit", async () => {
    vi.stubEnv("AI_DAILY_USER_LIMIT", "");
    vi.stubEnv("AI_DAILY_ANON_LIMIT", "");
    await checkAndBump(asAnon);
    expect(takes()[0].args.p_limits).toEqual([60, 20]);
    vi.stubEnv("AI_DAILY_USER_LIMIT", "5");
    vi.stubEnv("AI_DAILY_ANON_LIMIT", "99");
    await checkAndBump(asAnon);
    expect(takes()[1].args.p_limits).toEqual([5, 5]);
  });

  it("a signed-out caller has one bucket, the address, at the plain limit", async () => {
    await checkAndBump(signedOut);
    expect(takes()[0].args).toEqual({ p_buckets: [IP_BUCKET], p_limits: [3] });
  });

  it("the crisis classifier has its own counters: c:ip and c:u, 40 a day, so it cannot use up the model quota", async () => {
    await checkAndBump({ ...asAnon, task: "classify" });
    expect(takes()[0].args).toEqual({ p_buckets: ["c:ip:fedcba98", "c:u:0123456789abcdef"], p_limits: [40, 40] });
    await checkAndBump({ ...signedOut, task: "classify" });
    expect(takes()[1].args).toEqual({ p_buckets: ["c:ip:fedcba98"], p_limits: [40] });
    await checkAndBump({ ...asUser, task: "classify" });
    expect(takes()[2].args.p_limits).toEqual([200, 40]);
  });

  it("classifier calls and model calls do not share a bucket", async () => {
    for (let i = 0; i < 3; i++) await checkAndBump(signedOut);
    expect(await checkAndBump(signedOut)).toMatchObject({ ok: false });
    expect(await checkAndBump({ ...signedOut, task: "classify" })).toEqual({ ok: true });
  });

  it("allows exactly the limit, then refuses with the seconds until midnight UTC", async () => {
    for (let i = 0; i < 2; i++) expect(await checkAndBump(asAnon)).toEqual({ ok: true });
    expect(await checkAndBump(asAnon)).toEqual({ ok: false, retryAfterSec: 2 * 3600 });
  });

  it("the seconds until midnight are never more than a day", async () => {
    t = Date.UTC(2026, 10, 5, 0, 0, 0);
    mocks.now = () => t;
    mocks.day = "2026-11-05";
    resetLimitsForTest(() => t);
    for (let i = 0; i < 2; i++) await checkAndBump(asAnon);
    expect(await checkAndBump(asAnon)).toEqual({ ok: false, retryAfterSec: 86_400 });
  });

  it("a refusal counts nothing: the address bucket is not charged when the user bucket is full", async () => {
    for (let i = 0; i < 2; i++) await checkAndBump(asAnon);
    const before = mocks.rows.get(IP_BUCKET)?.calls;
    await checkAndBump(asAnon);
    expect(mocks.rows.get(IP_BUCKET)?.calls).toBe(before);
  });

  it("10 callers at once get exactly the limit, no more (the check and the count are one step)", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => checkAndBump(signedOut)));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
  });

  it("another user on the same address is limited by their own bucket", async () => {
    for (let i = 0; i < 2; i++) await checkAndBump(asAnon);
    expect(await checkAndBump({ ...asAnon, userHash: "b".repeat(32) })).toEqual({ ok: true });
  });

  it("starts again on the next UTC day", async () => {
    for (let i = 0; i < 3; i++) await checkAndBump(asAnon);
    t += 3 * HOUR;
    expect(await checkAndBump(asAnon)).toEqual({ ok: true });
  });
});

describe("checkAndBump with the store down or without the function: in-memory counter, one record, still served", () => {
  it.each([
    ["the function does not exist (42883)", () => (mocks.take = "missing")],
    ["the store is down", () => (mocks.down = true)],
    ["the store answers with something that is not true or false", () => (mocks.take = "garbage")],
  ])("%s: the request is served and ONE usage_store_down event is written for many failures", async (_label, breakIt) => {
    breakIt();
    for (let i = 0; i < 2; i++) expect(await checkAndBump(asAnon)).toEqual({ ok: true });
    expect(mocks.appEvents).toEqual([{ source: "server", area: "ai", code: "usage_store_down" }]);
  });

  it("still enforces the daily limit from memory, including the anonymous limit", async () => {
    mocks.down = true;
    for (let i = 0; i < 2; i++) await checkAndBump(asAnon);
    expect(await checkAndBump(asAnon)).toMatchObject({ ok: false });
  });

  it("says so again after five minutes of continued outage, not before", async () => {
    mocks.down = true;
    await checkAndBump(asAnon);
    t += 4 * 60_000;
    await checkAndBump({ ...asAnon, userHash: "d".repeat(32), ipHash: "1111111111111111" });
    expect(mocks.appEvents).toHaveLength(1);
    t += 2 * 60_000;
    await checkAndBump({ ...asAnon, userHash: "e".repeat(32), ipHash: "2222222222222222" });
    expect(mocks.appEvents).toHaveLength(2);
  });

  it("a store call that never answers is given up after 1.5 s, and the request is served from memory", async () => {
    vi.useFakeTimers();
    mocks.hang = true;
    const pending = checkAndBump(asAnon);
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

  it("prices an unknown model as the larger one, so the cap errs on the safe side, and says so once per model", () => {
    expect(costMicroUsd("some/other-model", 1000, 0, 1000)).toBe(costMicroUsd("openai/gpt-oss-120b", 1000, 0, 1000));
    costMicroUsd("some/other-model", 5, 0, 5);
    costMicroUsd("another/model", 5, 0, 5);
    expect(mocks.warnings).toEqual([
      { event: "ai_unknown_model_price", f: { model: "some/other-model" } },
      { event: "ai_unknown_model_price", f: { model: "another/model" } },
    ]);
  });

  it("says nothing for the two known models or for an empty name", () => {
    costMicroUsd("openai/gpt-oss-120b", 5, 0, 5);
    costMicroUsd("openai/gpt-oss-20b", 5, 0, 5);
    costMicroUsd("", 5, 0, 5);
    expect(mocks.warnings).toEqual([]);
  });

  it("cannot go negative or count more cached tokens than input tokens", () => {
    expect(costMicroUsd("openai/gpt-oss-20b", -5, 10, -5)).toBe(0);
    expect(costMicroUsd("openai/gpt-oss-20b", 100, 500, 0)).toBe(costMicroUsd("openai/gpt-oss-20b", 100, 100, 0));
  });
});

describe("the global spend cap", () => {
  it("is not reached below the cap", async () => {
    expect(await spendCapReached()).toBe(false);
    await recordSpend(999_999);
    expect(await spendCapReached()).toBe(false);
  });

  it("is reached once the day's spend hits AI_DAILY_GLOBAL_SPEND_CAP_USD, counting this instance's own spend at once", async () => {
    expect(await spendCapReached()).toBe(false);
    void recordSpend(600_000);
    void recordSpend(400_000);
    expect(await spendCapReached()).toBe(true);
  });

  it("recordSpend returns the promise that writes to the global bucket, so the caller can hand it to after()", async () => {
    const write = recordSpend(1234);
    expect(write).toBeInstanceOf(Promise);
    await write;
    expect(mocks.calls.filter((c) => c.fn === "ops_bump_ai_usage").map((c) => [c.args.p_bucket, c.args.p_cost_micro_usd])).toEqual([["global", 1234]]);
  });

  it("that promise never rejects, even with the store down", async () => {
    mocks.down = true;
    await expect(recordSpend(10)).resolves.toBeUndefined();
    expect(mocks.appEvents.some((e) => e.code === "usage_store_down")).toBe(true);
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
    void recordSpend(1_000_000);
    expect(await spendCapReached()).toBe(true);
    expect(mocks.appEvents.some((e) => e.code === "usage_store_down")).toBe(true);
  });

  it("defaults to 10 USD when the variable is not set", async () => {
    vi.stubEnv("AI_DAILY_GLOBAL_SPEND_CAP_USD", "");
    mocks.rows.set("global", { calls: 1, cost: 9_999_999 });
    expect(await spendCapReached()).toBe(false);
    void recordSpend(1);
    expect(await spendCapReached()).toBe(true);
  });
});
