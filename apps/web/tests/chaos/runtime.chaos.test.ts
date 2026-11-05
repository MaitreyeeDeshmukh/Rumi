/**
 * Chaos: Supabase is unreachable, slow or erroring, and a retry storm arrives. Covers the AI runtime's three modules
 * (flags, limits, cache) and the telemetry sinks, against the frozen interfaces in 08-production-addendum.md section 3.
 * The fake Supabase answers any query shape, so these tests do not depend on how a lane writes its queries.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { describeWhen } from "./lanes";
import { loadLane, type CacheModule, type FlagsModule, type LimitsModule, type SinksModule } from "./frozen";
import { captureLogs, expectNoLeak, USER_TEXT, type Logs } from "./fakes";
import { fakeSupabase, installSupabase, type Mode } from "./supabaseFake";

let logs: Logs;
beforeEach(() => {
  logs = captureLogs();
  vi.resetModules();
});
afterEach(() => {
  logs.stop();
  vi.useRealTimers();
  vi.doUnmock("server-only");
  vi.doUnmock("@/lib/supabase/admin");
  vi.doUnmock("@/lib/supabase/server");
  vi.doUnmock("next/server");
});

const clock = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
const BROKEN: Mode[] = ["down", "error", "hang"];

// Waiting for lane ai-runtime: src/lib/ai/flags.ts
describeWhen("ai-runtime", ["lib/ai/flags"], "chaos: feature flags when Supabase is unreachable", () => {
  async function load(mode: Mode = "ok") {
    const fake = fakeSupabase(mode);
    installSupabase(fake);
    return { fake, flags: await loadLane<FlagsModule>("lib/ai/flags") };
  }
  /** getFlag, advancing the clock so a hung lookup hits its timeout. */
  async function read(flags: FlagsModule, key: Parameters<FlagsModule["getFlag"]>[0]): Promise<boolean> {
    const pending = flags.getFlag(key);
    await vi.advanceTimersByTimeAsync(15_000);
    return pending;
  }

  it.each(BROKEN)("lookup %s: AI stays enabled (fail open) but cloud writes are disabled (fail safe for data)", async (mode) => {
    clock();
    const { flags } = await load(mode);
    expect(await read(flags, "ai_enabled")).toBe(true);
    expect(await read(flags, "cloud_sync_enabled")).toBe(false);
    expect(await read(flags, "memory_sync_enabled")).toBe(false);
    expectNoLeak(logs, "", false);
  });

  it("reads the stored value, and caches it for 30 s", async () => {
    clock();
    const { fake, flags } = await load();
    fake.flags.ai_enabled = false;
    expect(await read(flags, "ai_enabled")).toBe(false);
    const reads = fake.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await read(flags, "ai_enabled")).toBe(false);
    expect(fake.calls.length, "a second read inside 30 s must not query the database").toBe(reads);
  });

  it("flipping a flag off takes effect within 30 s (the kill switch works)", async () => {
    clock();
    const { fake, flags } = await load();
    expect(await read(flags, "ai_enabled")).toBe(true);
    fake.flags.ai_enabled = false;
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await read(flags, "ai_enabled")).toBe(false);
  });

  it.each(BROKEN)("when the database fails after a good read, the stale value is used, not the default (%s)", async (mode) => {
    clock();
    const { fake, flags } = await load();
    fake.flags.ai_enabled = false;
    expect(await read(flags, "ai_enabled")).toBe(false);
    await vi.advanceTimersByTimeAsync(31_000);
    fake.mode = mode;
    expect(await read(flags, "ai_enabled"), "stale false must win over the fail-open default true").toBe(false);
  });
});

// Waiting for lane ai-runtime: src/lib/ai/limits.ts
describeWhen("ai-runtime", ["lib/ai/limits"], "chaos: usage limits when Supabase is unreachable", () => {
  async function load(mode: Mode) {
    const fake = fakeSupabase(mode);
    installSupabase(fake);
    return loadLane<LimitsModule>("lib/ai/limits");
  }

  it.each(["down", "error"] as Mode[])("store %s: falls back to the in-memory limiter, which still allows normal use and still refuses a flood", async (mode) => {
    const limits = await load(mode);
    const args = { userHash: "u:aaaaaaaaaaaaaaaa", ipHash: "ip:bbbbbbbb", task: "plan" as const };
    const first = await limits.checkAndBump(args);
    expect(first.ok, "one request on a broken store must still be allowed").toBe(true);
    let refused: Awaited<ReturnType<LimitsModule["checkAndBump"]>> | undefined;
    for (let i = 0; i < 2_000 && refused === undefined; i += 1) {
      const r = await limits.checkAndBump(args);
      if (!r.ok) refused = r;
    }
    expect(refused, "a flood on a broken store must hit the memory limit").toBeDefined();
    expect(refused && !refused.ok && refused.retryAfterSec).toBeGreaterThanOrEqual(1);
    expectNoLeak(logs, "", false);
  });

  it("a hung store does not hang the request: the check still answers", async () => {
    clock();
    const limits = await load("hang");
    const pending = limits.checkAndBump({ userHash: null, ipHash: "ip:cccccccc", task: "sayit" });
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await pending).ok).toBe(true);
  });
});

// Waiting for lane ai-runtime: src/lib/ai/cache.ts
describeWhen("ai-runtime", ["lib/ai/cache"], "chaos: a retry storm single-flights", () => {
  const load = () => loadLane<CacheModule>("lib/ai/cache");

  it("100 identical in-flight requests run the work once and all get the same answer", async () => {
    const { singleFlight } = await load();
    let runs = 0;
    const work = async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { reply: "once" };
    };
    const all = await Promise.all(Array.from({ length: 100 }, () => singleFlight("same-key", work)));
    expect(runs).toBe(1);
    expect(new Set(all.map((a) => a.reply))).toEqual(new Set(["once"]));
  });

  it("a failure reaches every waiter and is not remembered: the next call runs the work again", async () => {
    const { singleFlight } = await load();
    let runs = 0;
    const failing = async (): Promise<string> => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("provider down");
    };
    const settled = await Promise.allSettled(Array.from({ length: 20 }, () => singleFlight("k-fail", failing)));
    expect(runs).toBe(1);
    expect(settled.every((s) => s.status === "rejected")).toBe(true);
    await expect(singleFlight("k-fail", async () => "recovered")).resolves.toBe("recovered");
  });

  it("different keys are never merged (one user's request cannot answer another's)", async () => {
    const { singleFlight } = await load();
    const [a, b] = await Promise.all([singleFlight("user-a", async () => "A"), singleFlight("user-b", async () => "B")]);
    expect([a, b]).toEqual(["A", "B"]);
  });
});

// Waiting for lane observability: src/lib/telemetry/sinks.ts
describeWhen("observability", ["lib/telemetry/sinks"], "chaos: telemetry writes fail", () => {
  const event = { id: "0b9e2f5c-1111-4222-8333-444455556666", task: "plan", promptVersion: "plan@1", outcome: "ok", degraded: false, attempts: 1, tier: "quality", redactions: 0, injectionHits: 0, thin: false, guardHits: [], memoryItems: 0, inTokens: 1, outTokens: 1, ms: 5 };
  const extra = { cacheStatus: "miss" as const, cachedTokens: 0, bucket: "ip:aaaaaaaa" };

  async function load(mode: Mode) {
    const fake = fakeSupabase(mode);
    const { afterRuns } = installSupabase(fake);
    return { fake, afterRuns, sinks: await loadLane<SinksModule>("lib/telemetry/sinks") };
  }

  it.each(["down", "error", "hang"] as Mode[])("database %s: never throws, returns at once, one stdout line first, nothing unhandled afterwards", async (mode) => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => void unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const { afterRuns, sinks } = await load(mode);
      const t0 = Date.now();
      let returned: unknown;
      expect(() => (returned = sinks.recordAiEvent(event, extra))).not.toThrow();
      expect(() => sinks.recordAppEvent({ source: "server", area: "ai", code: "x", fingerprint: "f", route: "/api/plan", release: "r", status: 500 })).not.toThrow();
      expect(returned, "the writer must not hand back a promise for the request to await").toBeUndefined();
      expect(Date.now() - t0).toBeLessThan(200);
      expect(logs.lines.length, "the stdout line is written before the database insert").toBeGreaterThan(0);
      // Run what was queued for after() the way Next does. A failing insert must be swallowed inside the sink: the callback
      // may finish or still be waiting (a hung insert), but it must never reject, because Next would then log the error text.
      const outcomes = await Promise.all(
        afterRuns.map((cb) =>
          Promise.race([Promise.resolve().then(cb).then(() => "finished", () => "rejected"), new Promise<string>((r) => setTimeout(() => r("still waiting"), 100))]),
        ),
      );
      expect(outcomes.filter((o) => o === "rejected")).toEqual([]);
      expect(afterRuns.length, "the database insert was queued with after()").toBeGreaterThan(0);
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
      expectNoLeak(logs);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("when after() itself throws (called outside a request) the sink still does not throw", async () => {
    vi.doMock("server-only", () => ({}));
    vi.doMock("@/lib/supabase/admin", () => ({ getAdminClient: () => fakeSupabase("down").client }));
    vi.doMock("next/server", () => ({
      after: () => {
        throw new Error("after was called outside a request scope BOOM-internal-detail-8f3a");
      },
    }));
    const sinks = await loadLane<SinksModule>("lib/telemetry/sinks");
    expect(() => sinks.recordAiEvent(event, extra)).not.toThrow();
    expectNoLeak(logs);
  });

  it("text smuggled into an event never reaches the stdout line", async () => {
    const { sinks } = await load("ok");
    sinks.recordAiEvent({ ...event, text: USER_TEXT, message: USER_TEXT, errorCode: USER_TEXT, id: USER_TEXT }, extra);
    sinks.recordAppEvent({ source: "server", area: "ai", code: USER_TEXT, fingerprint: USER_TEXT, route: USER_TEXT, release: "r", status: 500, text: USER_TEXT });
    expectNoLeak(logs);
  });
});
