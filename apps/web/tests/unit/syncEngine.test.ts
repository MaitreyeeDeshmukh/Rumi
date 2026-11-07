import { describe, expect, it } from "vitest";
import type { Appointment } from "@/features/shared/types";
import { createStateStore } from "@/features/state/stateStore";
import { createSyncEngine } from "@/features/sync/engine";
import { emptyMeta } from "@/features/sync/merge";
import { loadMeta, META_KEY } from "@/features/sync/meta";
import type { Result, SyncRepository } from "@/features/sync/types";
import type { PushBatchT, Remote } from "@/features/sync/wire";

/** An in-memory server with the same rule as sync_push: a change is kept only if its time is newer than the stored one. */
function fakeCloud() {
  const rows = new Map<string, { kind: "appointments" | "documents" | "chats"; rec: Remote["appointments"][number] | Remote["documents"][number] | Remote["chats"][number] }>();
  const state = { consent: false, paused: false, down: false, pushes: 0 };
  const repo = (): SyncRepository => ({
    async getConsent() {
      return state.down ? fail("failed") : state.paused ? fail("paused") : ok({ granted: state.consent });
    },
    async setConsent(granted) {
      if (state.down) return fail("failed");
      state.consent = granted;
      return ok({ granted });
    },
    async pull() {
      if (state.down) return fail("failed");
      if (state.paused) return fail("paused");
      if (!state.consent) return fail("consent");
      const out: Remote = { appointments: [], documents: [], chats: [], unreadable: [] };
      for (const { kind, rec } of rows.values()) (out[kind] as unknown[]).push(structuredClone(rec));
      return ok(out);
    },
    async push(batch: PushBatchT) {
      if (state.down) return fail("failed");
      if (!state.consent) return fail("consent");
      state.pushes++;
      for (const kind of ["appointments", "documents", "chats"] as const) {
        for (const rec of batch[kind]) {
          const key = `${kind}:${rec.id}`;
          const held = rows.get(key);
          if (!held || Date.parse(rec.updated_at) > Date.parse(held.rec.updated_at)) rows.set(key, { kind, rec: structuredClone(rec) });
        }
      }
      return ok({ written: 1 });
    },
    async forget() {
      rows.clear();
      state.consent = false;
      return ok(null);
    },
  });
  return { rows, state, repo };
}
const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (reason: "consent" | "paused" | "auth" | "account" | "failed"): { ok: false; reason: typeof reason } => ({ ok: false, reason });

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

/** A manual clock and timers, so no test waits. */
function device(cloud: ReturnType<typeof fakeCloud>, clock: { t: number }) {
  const storage = memoryStorage();
  const store = createStateStore({ storage: memoryStorage() });
  store.hydrate();
  const timers: Array<() => void> = [];
  const engine = createSyncEngine({
    store, repo: cloud.repo(), storage, initialMeta: loadMeta(storage),
    now: () => clock.t, setTimer: (fn) => timers.push(fn), clearTimer: () => undefined,
  });
  return { store, engine, storage, timers };
}
const appt = (id: string, reason: string): Appointment => ({
  id, care: "primary", providerName: "Dr Ray", clinic: "North clinic", date: "2026-12-01", time: "09:30", reason, status: "to_confirm",
  createdAt: "2026-11-01T10:00:00.000Z", questions: [], bring: [], symptoms: [],
});
const add = (d: ReturnType<typeof device>, a: Appointment) => d.store.update((s) => void (s.appointments = [...(s.appointments ?? []), a]));
const edit = (d: ReturnType<typeof device>, id: string, reason: string) => d.store.update((s) => void (s.appointments = (s.appointments ?? []).map((a) => (a.id === id ? { ...a, reason } : a))));
const reasons = (d: ReturnType<typeof device>) => (d.store.getSnapshot().state.appointments ?? []).map((a) => `${a.id}:${a.reason}`);

describe("sync engine", () => {
  it("does nothing until the person turned sync on", async () => {
    const cloud = fakeCloud();
    const clock = { t: Date.parse("2026-11-01T10:00:00Z") };
    const a = device(cloud, clock);
    add(a, appt("a1", "check"));
    await a.engine.attach("user-1");
    expect(a.engine.getStatus()).toMatchObject({ on: false, phase: "off" });
    expect(cloud.state.pushes).toBe(0);
  });

  it("pushes after enable, and a second device pulls the same data on sign-in", async () => {
    const cloud = fakeCloud();
    const clock = { t: Date.parse("2026-11-01T10:00:00Z") };
    const a = device(cloud, clock);
    add(a, appt("a1", "check"));
    await a.engine.attach("user-1");
    expect((await a.engine.enable()).ok).toBe(true);
    await a.engine.syncNow();
    expect(cloud.rows.size).toBe(1);

    const b = device(cloud, clock);
    await b.engine.attach("user-1"); // consent is read from the account, then it pulls
    expect(b.engine.getStatus().on).toBe(true);
    expect(reasons(b)).toEqual(["a1:check"]);
  });

  it("an edit is pushed after the pause and the other device sees the newest edit (last write wins)", async () => {
    const cloud = fakeCloud();
    const clock = { t: Date.parse("2026-11-01T10:00:00Z") };
    const a = device(cloud, clock);
    const b = device(cloud, clock);
    add(a, appt("a1", "check"));
    await a.engine.attach("u");
    await a.engine.enable();
    await a.engine.syncNow();
    await b.engine.attach("u");

    clock.t += 1000;
    edit(b, "a1", "from b");
    clock.t += 1000;
    edit(a, "a1", "from a"); // later
    expect(a.timers.length).toBeGreaterThan(0); // a push is planned, not sent at once
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(reasons(a)).toEqual(["a1:from a"]);
    expect(reasons(b)).toEqual(["a1:from a"]);
  });

  it("a delete on one device removes it on the other", async () => {
    const cloud = fakeCloud();
    const clock = { t: Date.parse("2026-11-01T10:00:00Z") };
    const a = device(cloud, clock);
    const b = device(cloud, clock);
    add(a, appt("a1", "check"));
    await a.engine.attach("u");
    await a.engine.enable();
    await a.engine.syncNow();
    await b.engine.attach("u");
    expect(reasons(b)).toHaveLength(1);
    clock.t += 1000;
    a.store.update((s) => void delete s.appointments);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(reasons(b)).toEqual([]);
    expect(JSON.stringify([...cloud.rows.values()])).not.toContain("North clinic"); // the content went with it
  });

  it("works offline: a failed push loses nothing and the next run sends it", async () => {
    const cloud = fakeCloud();
    const clock = { t: Date.parse("2026-11-01T10:00:00Z") };
    const a = device(cloud, clock);
    await a.engine.attach("u");
    await a.engine.enable();
    cloud.state.down = true;
    add(a, appt("a1", "offline"));
    await a.engine.syncNow();
    expect(a.engine.getStatus().phase).toMatch(/error|offline/);
    expect(reasons(a)).toEqual(["a1:offline"]);
    cloud.state.down = false;
    await a.engine.syncNow();
    expect(cloud.rows.size).toBe(1);
    expect(a.engine.getStatus().phase).toBe("idle");
  });

  it("consent taken back on another device switches sync off here; the kill switch only pauses", async () => {
    const cloud = fakeCloud();
    const clock = { t: Date.parse("2026-11-01T10:00:00Z") };
    const a = device(cloud, clock);
    await a.engine.attach("u");
    await a.engine.enable();
    cloud.state.paused = true;
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: "paused", on: true });
    cloud.state.paused = false;
    cloud.state.consent = false;
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: "off", on: false });
    expect(JSON.parse(a.storage.getItem(META_KEY) ?? "{}").on).toBe(false);
  });

  it("a guest or signed-out visitor never reaches the server", async () => {
    const cloud = fakeCloud();
    const a = device(cloud, { t: 1 });
    await a.engine.attach(null);
    expect((await a.engine.enable()).ok).toBe(false);
    expect(cloud.state.pushes).toBe(0);
  });

  it("another account on the same device starts with fresh marks and sync off until its consent is read", async () => {
    const cloud = fakeCloud();
    const a = device(cloud, { t: Date.parse("2026-11-01T10:00:00Z") });
    await a.engine.attach("user-1");
    await a.engine.enable();
    cloud.state.consent = false; // the second account has not agreed
    await a.engine.attach("user-2");
    expect(a.engine.getStatus().on).toBe(false);
    expect(loadMeta(a.storage)).toMatchObject({ userId: "user-2", on: false });
  });

  it("deleting the cloud copy empties the server, keeps the device data and turns sync off", async () => {
    const cloud = fakeCloud();
    const a = device(cloud, { t: Date.parse("2026-11-01T10:00:00Z") });
    add(a, appt("a1", "check"));
    await a.engine.attach("u");
    await a.engine.enable();
    await a.engine.syncNow();
    expect((await a.engine.deleteCloudCopy()).ok).toBe(true);
    expect(cloud.rows.size).toBe(0);
    expect(reasons(a)).toHaveLength(1);
    expect(a.engine.getStatus().on).toBe(false);
    expect(a.storage.getItem(META_KEY)).toBeNull();
    expect(emptyMeta().records).toEqual({});
  });
});
