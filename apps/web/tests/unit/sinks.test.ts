import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  jobs: [] as Promise<void>[],
  afterThrows: false,
  rows: [] as { table: string; row: Record<string, unknown> }[],
  rpcs: [] as { fn: string; args: Record<string, unknown> | undefined }[],
  mode: "ok" as "ok" | "error" | "throw" | "hang" | "manual" | "adminThrows",
  resolvers: [] as (() => void)[],
}));

vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => {
    if (h.afterThrows) throw new Error("`after` was called outside a request scope");
    h.jobs.push(fn());
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    if (h.mode === "adminThrows") throw new Error("SUPABASE_SECRET_KEY missing");
    const reply = (): PromiseLike<{ error: unknown }> => {
      if (h.mode === "hang") return new Promise(() => undefined);
      if (h.mode === "manual") return new Promise((res) => h.resolvers.push(() => res({ error: null })));
      if (h.mode === "throw") throw new Error("connection reset SECRETTEXT");
      return Promise.resolve({ error: h.mode === "error" ? { message: "boom SECRETTEXT" } : null });
    };
    return {
      from: (table: string) => ({
        insert: (row: Record<string, unknown>) => {
          h.rows.push({ table, row });
          return reply();
        },
      }),
      rpc: (fn: string, args?: Record<string, unknown>) => {
        h.rpcs.push({ fn, args });
        return reply();
      },
    };
  },
}));

import { setLogSink, type AiEvent } from "@/lib/ai/telemetry";
import { resetThrottle } from "@/lib/telemetry/throttle";
import { dbOutcome, recordAiEvent, recordAppEvent, resetSinkState, type AppEvent } from "@/lib/telemetry/sinks";

const base: AiEvent = {
  id: "5f1d7c52-8f58-4d52-9a47-0f7a1b2c3d4e",
  task: "plan",
  promptVersion: "plan@3",
  outcome: "ok",
  degraded: false,
  attempts: 1,
  tier: "quality",
  redactions: 0,
  injectionHits: 0,
  thin: false,
  guardHits: ["advice_dose"],
  memoryItems: 1,
  inTokens: 800,
  outTokens: 190,
  ms: 1234,
};
const extra = { cacheStatus: "miss", cachedTokens: 12, bucket: "u:0123456789abcdef" } as const;
const appEvent: AppEvent = { source: "server", area: "ai", code: "ai_unavailable", fingerprint: "abcdef0123456789", route: "/api/plan", status: 503 };

const lines: string[] = [];
const settle = async (): Promise<void> => {
  await Promise.all(h.jobs.splice(0));
};

beforeEach(() => {
  setLogSink((l) => lines.push(l));
});
afterEach(() => {
  setLogSink(null);
  lines.length = 0;
  h.jobs.length = 0;
  h.rows.length = 0;
  h.rpcs.length = 0;
  h.mode = "ok";
  h.afterThrows = false;
  resetSinkState();
  resetThrottle();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("outcome mapping (addendum section 2)", () => {
  it("maps every harness outcome", () => {
    const map = (outcome: AiEvent["outcome"], errorCode?: AiEvent["errorCode"]) => dbOutcome({ outcome, errorCode });
    expect(map("ok")).toBe("ok");
    expect(map("crisis")).toBe("crisis");
    expect(map("fallback")).toBe("degraded");
    expect(map("mock")).toBeNull();
    expect(map("error", "forbidden")).toBe("unauthorized");
    expect(map("error", "rate_limited")).toBe("rate_limited");
    expect(map("error", "bad_input")).toBe("invalid_input");
    expect(map("error", "too_large")).toBe("invalid_input");
    expect(map("error", "ai_unavailable")).toBe("provider_error");
    expect(map("error", "ai_invalid")).toBe("guard_blocked");
    expect(map("error", "config")).toBe("config_error");
    expect(map("error", "timeout")).toBe("timeout");
    expect(map("error", undefined)).toBe("provider_error");
  });
});

describe("recordAiEvent", () => {
  it("writes a stdout line first, then one ops_ai_events row inside after()", async () => {
    recordAiEvent(base, extra);
    expect(lines).toHaveLength(1);
    expect(h.jobs).toHaveLength(1);
    await settle();
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].table).toBe("ops_ai_events");
    expect(h.rows[0].row).toEqual({
      task: "plan",
      outcome: "ok",
      tier: "quality",
      prompt_version: "plan@3",
      attempts: 1,
      guard_codes: ["hard:advice_dose"],
      latency_ms: 1234,
      input_tokens: 800,
      output_tokens: 190,
      bucket: "u:0123456789abcdef",
      cache_status: "miss",
      cached_tokens: 12,
    });
    const line = JSON.parse(lines[0]) as Record<string, unknown>;
    expect([line.type, line.cacheStatus, line.cachedTokens]).toEqual(["ai_task", "miss", 12]);
  });

  it("does not store mock events and stores a fallback as degraded with tier fallback", async () => {
    recordAiEvent({ ...base, outcome: "mock" }, extra);
    recordAiEvent({ ...base, outcome: "fallback", degraded: true, tier: "none" }, extra);
    await settle();
    expect(lines).toHaveLength(2);
    expect(h.rows.map((r) => [r.row.outcome, r.row.tier])).toEqual([["degraded", "fallback"]]);
  });

  it("cleans bad extras instead of trusting them", async () => {
    recordAiEvent(base, { cacheStatus: "weird", cachedTokens: -5, bucket: "u:HAS SPACES and text" } as never);
    await settle();
    expect(h.rows[0].row).toMatchObject({ cache_status: "bypass", cached_tokens: 0, bucket: null });
  });

  it("never lets user text into the line or the row, whatever the caller casts in", async () => {
    recordAiEvent({ ...base, text: "my knee hurts SECRETTEXT", errorCode: "SECRETTEXT" } as never, { ...extra, bucket: "SECRETTEXT" } as never);
    await settle();
    expect(lines.join("") + JSON.stringify(h.rows)).not.toContain("SECRETTEXT");
  });

  it("returns at once when the store hangs, then logs one warning line after the 2 s cap", async () => {
    vi.useFakeTimers();
    h.mode = "hang";
    const t0 = Date.now();
    expect(recordAiEvent(base, extra)).toBeUndefined();
    expect(Date.now() - t0).toBe(0); // returned without waiting
    expect(lines).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2100);
    await settle();
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1])).toEqual({ type: "telemetry_store_failed", store: "ops_ai_events", reason: "timeout" });
  });

  it("swallows a throwing store, an error reply and a missing admin key with one line each, without their messages", async () => {
    for (const mode of ["throw", "error", "adminThrows"] as const) {
      h.mode = mode;
      lines.length = 0;
      expect(() => recordAiEvent(base, extra)).not.toThrow();
      await settle();
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain("telemetry_store_failed");
      expect(lines.join("")).not.toContain("SECRETTEXT");
      expect(lines.join("")).not.toContain("SUPABASE_SECRET_KEY");
      resetSinkState();
    }
  });

  it("runs the write itself when after() is unavailable, and still never throws", async () => {
    h.afterThrows = true;
    expect(() => recordAiEvent(base, extra)).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.rows).toHaveLength(1);
  });

  it("never throws on garbage input", () => {
    for (const bad of [null, undefined, 42, "x", { id: 1 }]) {
      expect(() => recordAiEvent(bad as never, undefined as never)).not.toThrow();
    }
  });

  it("stops writing to a dead store after 5 failures in a row, keeps writing stdout, then retries after 30 s", async () => {
    vi.useFakeTimers();
    h.mode = "error";
    for (let i = 0; i < 5; i++) {
      recordAiEvent(base, extra);
      await settle();
    }
    expect(lines.some((l) => l.includes("telemetry_store_paused"))).toBe(true);
    const rowsBefore = h.rows.length;
    lines.length = 0;
    recordAiEvent(base, extra);
    await settle();
    expect(h.rows.length).toBe(rowsBefore); // skipped
    expect(lines.filter((l) => l.includes("ai_task"))).toHaveLength(1); // the event's own stdout line is still written
    await vi.advanceTimersByTimeAsync(31_000);
    h.mode = "ok";
    recordAiEvent(base, extra);
    await settle();
    expect(h.rows.length).toBe(rowsBefore + 1);
  });

  it("caps work in flight when the store is slow, so a flood cannot pile up", async () => {
    vi.useFakeTimers();
    h.mode = "hang";
    for (let i = 0; i < 200; i++) recordAiEvent(base, extra);
    expect(h.rows.length).toBe(50);
    expect(lines.filter((l) => l.includes("ai_task"))).toHaveLength(200); // every event still reached stdout
    expect(lines.filter((l) => l.includes("telemetry_dropped"))).toHaveLength(1); // and the drops were reported once
    await vi.advanceTimersByTimeAsync(2100);
    await settle();
  });
});

describe("recordAppEvent", () => {
  it("writes a stdout line then calls ops_log_app_event with the frozen argument names", async () => {
    recordAppEvent(appEvent);
    expect(lines).toHaveLength(1);
    await settle();
    expect(h.rpcs).toHaveLength(1);
    expect(h.rpcs[0].fn).toBe("ops_log_app_event");
    expect(Object.keys(h.rpcs[0].args ?? {}).sort()).toEqual(["p_area", "p_code", "p_fingerprint", "p_release", "p_route", "p_source", "p_status"]);
    expect(h.rpcs[0].args).toMatchObject({ p_source: "server", p_area: "ai", p_code: "ai_unavailable", p_fingerprint: "abcdef0123456789", p_route: "/api/plan", p_status: 503 });
  });

  it("checks every field: bad code, area, source, route, fingerprint and status become fixed values or null", async () => {
    recordAppEvent({ source: "evil", area: "evil", code: "Has Spaces and TEXT", fingerprint: "not hex!!", route: "/api/x?token=abc", status: 99999 } as never);
    await settle();
    expect(h.rpcs[0].args).toMatchObject({ p_source: "server", p_area: "app", p_code: "invalid_code", p_fingerprint: null, p_route: "/api/x", p_status: null });
    recordAppEvent({ ...appEvent, route: "https://evil.example/x", code: "a".repeat(61) });
    await settle();
    expect(h.rpcs[1].args).toMatchObject({ p_route: null, p_code: "invalid_code" });
  });

  it("is swallowed when the store hangs or throws", async () => {
    vi.useFakeTimers();
    h.mode = "hang";
    expect(() => recordAppEvent(appEvent)).not.toThrow();
    await vi.advanceTimersByTimeAsync(2100);
    await settle();
    expect(lines.filter((l) => l.includes("telemetry_store_failed"))).toHaveLength(1);
    h.mode = "throw";
    expect(() => recordAppEvent({ ...appEvent, code: "other_code" })).not.toThrow();
    await settle();
    expect(lines.join("")).not.toContain("SECRETTEXT");
  });
});

describe("per-store breaker, half-open probe, drop counter, kill switch", () => {
  const aiFail = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      recordAiEvent(base, extra);
      await settle();
    }
  };

  it("trips each store on its own: a dead ops_ai_events does not pause ops_app_events", async () => {
    vi.useFakeTimers();
    h.mode = "error";
    await aiFail(5);
    expect(lines.some((l) => l.includes('"store":"ops_ai_events"') && l.includes("telemetry_store_paused"))).toBe(true);
    h.mode = "ok";
    recordAppEvent(appEvent);
    await settle();
    expect(h.rpcs).toHaveLength(1); // the app store still writes
    const before = h.rows.length;
    recordAiEvent(base, extra);
    await settle();
    expect(h.rows.length).toBe(before); // the ai store is still paused
  });

  it("after the pause only ONE probe call goes out; everything else stays paused until it answers", async () => {
    vi.useFakeTimers();
    h.mode = "error";
    await aiFail(5);
    await vi.advanceTimersByTimeAsync(31_000);
    h.mode = "hang";
    const before = h.rows.length;
    for (let i = 0; i < 20; i++) recordAiEvent(base, extra);
    expect(h.rows.length).toBe(before + 1); // one probe, 19 dropped
    await vi.advanceTimersByTimeAsync(2100); // the probe times out: breaker opens again
    await settle();
    h.mode = "ok";
    recordAiEvent(base, extra);
    await settle();
    expect(h.rows.length).toBe(before + 1); // paused again for another 30 s
    await vi.advanceTimersByTimeAsync(31_000);
    recordAiEvent(base, extra); // probe succeeds: closed
    await settle();
    expect(h.rows.length).toBe(before + 2);
    recordAiEvent(base, extra);
    recordAiEvent(base, extra);
    await settle();
    expect(h.rows.length).toBe(before + 4); // normal writes resume
  });

  it("a slow success that started before the breaker opened does not close it", async () => {
    vi.useFakeTimers();
    h.mode = "manual";
    recordAiEvent(base, extra); // in flight, not answered yet
    h.jobs.length = 0; // settle() must not wait for it
    h.mode = "error";
    await aiFail(5);
    expect(lines.some((l) => l.includes("telemetry_store_paused"))).toBe(true);
    h.resolvers.forEach((r) => r()); // the old call now succeeds, late
    await vi.advanceTimersByTimeAsync(1);
    const before = h.rows.length;
    recordAiEvent(base, extra);
    await settle();
    expect(h.rows.length).toBe(before);
  });

  it("counts dropped writes and reports them in one warning line per minute", async () => {
    vi.useFakeTimers();
    h.mode = "error";
    await aiFail(5);
    lines.length = 0;
    for (let i = 0; i < 30; i++) recordAiEvent(base, extra); // all dropped (paused)
    const droppedLines = (): Record<string, unknown>[] => lines.filter((l) => l.includes("telemetry_dropped")).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(droppedLines()).toHaveLength(1); // the first drop reports at once
    await vi.advanceTimersByTimeAsync(10_000);
    for (let i = 0; i < 30; i++) recordAiEvent(base, extra);
    expect(droppedLines()).toHaveLength(1); // still inside the minute
    await vi.advanceTimersByTimeAsync(61_000);
    h.mode = "hang"; // the probe goes out and hangs, the rest drop
    for (let i = 0; i < 5; i++) recordAiEvent(base, extra);
    const reports = droppedLines();
    expect(reports).toHaveLength(2);
    expect(reports[1].dropped).toBeGreaterThanOrEqual(30); // what was dropped since the last line
    await vi.advanceTimersByTimeAsync(2100);
    await settle();
  });

  it("TELEMETRY_DB_WRITES=off skips every database write and keeps stdout", async () => {
    vi.stubEnv("TELEMETRY_DB_WRITES", "off");
    recordAiEvent(base, extra);
    recordAppEvent(appEvent);
    await settle();
    expect(h.rows).toHaveLength(0);
    expect(h.rpcs).toHaveLength(0);
    expect(lines).toHaveLength(2);
    vi.stubEnv("TELEMETRY_DB_WRITES", "on");
    recordAiEvent(base, extra);
    await settle();
    expect(h.rows).toHaveLength(1);
    vi.unstubAllEnvs();
  });
});

describe("app event volume cap", () => {
  it("writes one row per minute per (source, code, fingerprint, route) and counts the rest in the next stdout line", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 50; i++) recordAppEvent(appEvent);
    await settle();
    expect(h.rpcs).toHaveLength(1);
    expect(lines).toHaveLength(50); // every event is still on stdout
    expect(lines.filter((l) => l.includes('"suppressed":true'))).toHaveLength(49);
    await vi.advanceTimersByTimeAsync(61_000);
    recordAppEvent(appEvent);
    await settle();
    expect(h.rpcs).toHaveLength(2);
    expect(JSON.parse(lines[lines.length - 1]).repeats).toBe(49);
  });

  it("different keys each get their row, but all keys together are capped at 120 rows a minute", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 300; i++) {
      recordAppEvent({ ...appEvent, fingerprint: `abc${String(i).padStart(5, "0")}` });
      if (i % 40 === 39) await settle(); // let writes finish so the in-flight cap is not what limits this
    }
    await settle();
    expect(h.rpcs).toHaveLength(120);
    await vi.advanceTimersByTimeAsync(61_000);
    recordAppEvent({ ...appEvent, fingerprint: "zzzzzzzz" });
    await settle();
    expect(h.rpcs).toHaveLength(121);
  });
});
