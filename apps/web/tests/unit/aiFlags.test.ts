import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFlag, resetFlagsForTest } from "@/lib/ai/flags";

const FLAG_TTL_MS = 30_000;
const FLAG_READ_MS = 1_500;

const mocks = vi.hoisted(() => ({
  reads: 0,
  next: undefined as undefined | (() => PromiseLike<{ data: unknown; error: unknown }>),
  appEvents: [] as unknown[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: (table: string) => ({
      select: () => {
        if (table !== "ops_feature_flags") throw new Error("wrong table");
        mocks.reads += 1;
        if (mocks.next === undefined) throw new Error("database is down");
        return mocks.next();
      },
    }),
  }),
}));
vi.mock("@/lib/telemetry/sinks", () => ({ recordAppEvent: (e: unknown) => mocks.appEvents.push(e), recordAiEvent: () => undefined }));

const rows = (over: Record<string, boolean> = {}): { data: unknown; error: null } => ({
  data: Object.entries({ ai_enabled: true, memory_sync_enabled: true, cloud_sync_enabled: true, ...over }).map(([key, enabled]) => ({ key, enabled })),
  error: null,
});

let t = 0;
beforeEach(() => {
  t = 1_000_000;
  mocks.reads = 0;
  mocks.next = undefined;
  mocks.appEvents.length = 0;
  resetFlagsForTest(() => t);
});
afterEach(() => vi.useRealTimers());

describe("getFlag", () => {
  it("reads the three flags with one query and keeps them for 30 s", async () => {
    mocks.next = () => Promise.resolve(rows({ ai_enabled: false }));
    expect(await getFlag("ai_enabled")).toBe(false);
    expect(await getFlag("memory_sync_enabled")).toBe(true);
    expect(await getFlag("cloud_sync_enabled")).toBe(true);
    expect(mocks.reads).toBe(1);
    t += FLAG_TTL_MS - 1;
    await getFlag("ai_enabled");
    expect(mocks.reads).toBe(1);
  });

  it("reads again after 30 s and sees a flipped flag (the kill-switch works)", async () => {
    mocks.next = () => Promise.resolve(rows({ ai_enabled: true }));
    expect(await getFlag("ai_enabled")).toBe(true);
    mocks.next = () => Promise.resolve(rows({ ai_enabled: false }));
    t += FLAG_TTL_MS;
    expect(await getFlag("ai_enabled")).toBe(false);
    expect(mocks.reads).toBe(2);
  });

  it("with the database down and no earlier value: AI stays on, cloud and memory writes stay off", async () => {
    expect(await getFlag("ai_enabled")).toBe(true);
    expect(await getFlag("memory_sync_enabled")).toBe(false);
    expect(await getFlag("cloud_sync_enabled")).toBe(false);
  });

  it("with the database down it does not ask again on every request: one retry per 30 s, one app event per failure", async () => {
    for (let i = 0; i < 20; i++) await getFlag("ai_enabled");
    expect(mocks.reads).toBe(1);
    expect(mocks.appEvents).toEqual([{ source: "server", area: "db", code: "flags_read_failed" }]);
    t += FLAG_TTL_MS;
    await getFlag("ai_enabled");
    expect(mocks.reads).toBe(2);
  });

  it("uses the last known value when a later read fails (a flipped-off kill-switch stays off during an outage)", async () => {
    mocks.next = () => Promise.resolve(rows({ ai_enabled: false, cloud_sync_enabled: true }));
    expect(await getFlag("ai_enabled")).toBe(false);
    mocks.next = () => Promise.resolve({ data: null, error: { message: "boom" } });
    t += FLAG_TTL_MS;
    expect(await getFlag("ai_enabled")).toBe(false);
    expect(await getFlag("cloud_sync_enabled")).toBe(true);
    expect(mocks.appEvents).toHaveLength(1);
  });

  it("a later read that returns only some rows changes only those flags; the others keep their last value", async () => {
    mocks.next = () => Promise.resolve(rows({ ai_enabled: false, cloud_sync_enabled: false }));
    await getFlag("ai_enabled");
    mocks.next = () => Promise.resolve({ data: [{ key: "cloud_sync_enabled", enabled: true }], error: null });
    t += FLAG_TTL_MS;
    expect(await getFlag("cloud_sync_enabled")).toBe(true);
    expect(await getFlag("ai_enabled")).toBe(false);
  });

  it("collapses concurrent callers into one query", async () => {
    let release!: () => void;
    mocks.next = () => new Promise((resolve) => (release = () => resolve(rows())));
    const all = [getFlag("ai_enabled"), getFlag("ai_enabled"), getFlag("cloud_sync_enabled")];
    await Promise.resolve();
    release();
    expect(await Promise.all(all)).toEqual([true, true, true]);
    expect(mocks.reads).toBe(1);
  });

  it("gives up on a database that never answers after 1.5 s and uses the defaults", async () => {
    vi.useFakeTimers();
    mocks.next = () => new Promise(() => undefined);
    const pending = getFlag("ai_enabled");
    await vi.advanceTimersByTimeAsync(FLAG_READ_MS);
    expect(await pending).toBe(true);
    expect(mocks.appEvents).toHaveLength(1);
  });

  it("ignores rows with an unknown key or a value that is not a boolean", async () => {
    mocks.next = () =>
      Promise.resolve({ data: [{ key: "something_else", enabled: false }, { key: "ai_enabled", enabled: "no" }, { key: "cloud_sync_enabled", enabled: true }], error: null });
    expect(await getFlag("ai_enabled")).toBe(true);
    expect(await getFlag("cloud_sync_enabled")).toBe(true);
  });
});
