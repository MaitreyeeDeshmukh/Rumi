import { describe, expect, it } from "vitest";
import { createStateStore } from "@/features/state/stateStore";
import { KEY, loadState } from "@/lib/storage";
import { fakeMemoryDb } from "./helpers/fakeMemoryDb";
import { fakeStorage } from "./helpers/fakeStorage";
import { json, memoryDevice, practice, preset } from "./helpers/memoryDevice";
import { createMemoryActions } from "@/features/memory/actions";

const CARD = [preset("p1"), preset("p2"), preset("p5", false)];
const T1 = "2026-11-05T10:00:00.000Z";
const T2 = "2026-11-05T11:00:00.000Z";
const ids = (d: ReturnType<typeof memoryDevice>) => d.state().persona.facts.map((f) => f.id).sort();
const stored = (db: ReturnType<typeof fakeMemoryDb>) => [...db.rows.keys()].sort();

describe("setAuthStatus", () => {
  it("without any sign-in information nothing goes out; once the screen reports ready it does, and offline stops it again", async () => {
    const db = fakeMemoryDb();
    const d = memoryDevice(db, { card: CARD });
    const bare = createMemoryActions({ store: d.store, fetchFn: (async () => json(200, {})) as typeof fetch });
    expect(await bare.enableMemory()).toEqual({ ok: false, remote: "paused" });
    bare.setAuthStatus("ready");
    expect((await bare.enableMemory()).remote).toBe("failed"); // reached the fake network, which answered nothing useful
    bare.setAuthStatus("offline");
    expect(await bare.enableMemory()).toEqual({ ok: false, remote: "paused" });
  });
});

describe("syncPersona: local first", () => {
  it("memory off: facts are saved on the device, nothing goes over the network", async () => {
    const db = fakeMemoryDb();
    const d = memoryDevice(db, { card: CARD });
    expect(await d.actions.syncPersona()).toEqual({ saved: 3, remote: "off" });
    expect(ids(d)).toEqual(["pacing:one_question", "support_pref:p1", "support_pref:p2"]);
    expect(loadState(d.storage).persona.facts).toHaveLength(3);
    expect(d.calls).toEqual([]);
    expect(db.calls).toEqual([]);
  });

  it("nothing runs before the state is hydrated", async () => {
    const d = memoryDevice(fakeMemoryDb(), { hydrate: false, card: [] });
    expect(await d.actions.syncPersona()).toEqual({ saved: 0, remote: "failed" });
    expect(await d.actions.enableMemory()).toEqual({ ok: false, remote: "failed" });
    expect(await d.actions.disableMemory()).toEqual({ ok: false, remote: "failed" });
    expect(await d.actions.forgetAll()).toEqual({ remote: "failed" });
    expect(d.calls).toEqual([]);
  });
});

describe("enableMemory", () => {
  it("grants consent on the server, switches on, and pushes the facts", async () => {
    const db = fakeMemoryDb();
    const d = memoryDevice(db, { card: CARD });
    expect(await d.actions.enableMemory()).toEqual({ ok: true, remote: "ok" });
    expect(d.state().settings.memoryOptIn).toBe(true);
    expect(db.consent).toBe(true);
    expect(stored(db)).toEqual(["pacing:one_question", "support_pref:p1", "support_pref:p2"]);
    expect(d.calls.map((c) => c.path)).toEqual(["/api/memory/consent", "/api/memory/facts"]);
    expect(d.calls[0].body).toEqual({ granted: true });
  });

  it("sends only kind, key, level and a change time: no ids, no text, no code", async () => {
    const db = fakeMemoryDb();
    const d = memoryDevice(db, { card: CARD });
    await d.actions.enableMemory();
    expect(d.calls[1].body).toEqual({
      facts: [
        { kind: "support_pref", key: "p1", client_updated_at: T1 },
        { kind: "support_pref", key: "p2", client_updated_at: T1 },
        { kind: "pacing", key: "one_question", client_updated_at: T1 },
      ],
      removed: [],
    });
  });

  it("sign-in not ready: paused, memory stays off, nothing is sent", async () => {
    for (const status of ["signing_in", "degraded", "offline"] as const) {
      const d = memoryDevice(fakeMemoryDb(), { card: CARD, auth: status });
      expect(await d.actions.enableMemory()).toEqual({ ok: false, remote: "paused" });
      expect(d.state().settings.memoryOptIn).toBe(false);
      expect(d.calls).toEqual([]);
    }
  });

  it("the server cannot be reached: memory stays off, the person is told it failed", async () => {
    const d = memoryDevice(fakeMemoryDb(), { card: CARD });
    d.answers.push("throw", "throw", "throw");
    expect(await d.actions.enableMemory()).toEqual({ ok: false, remote: "failed" });
    expect(d.state().settings.memoryOptIn).toBe(false);
  });
});

describe("syncPersona: remote", () => {
  async function enabled(over = {}) {
    const db = fakeMemoryDb();
    const d = memoryDevice(db, { card: CARD, ...over });
    await d.actions.enableMemory();
    d.calls.length = 0;
    return { db, d };
  }

  it("while sign-in is not ready the facts stay on the device and the status is paused; the next sync catches up", async () => {
    const { db, d } = await enabled();
    d.auth.status = "offline";
    d.store.update((x) => void (x.supportCard = { id: "c", topQuestionIds: [], items: [preset("p3")] }));
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "paused" });
    expect(d.calls).toEqual([]);
    expect(stored(db)).not.toContain("support_pref:p3");
    d.auth.status = "ready";
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "ok" });
    expect(stored(db)).toContain("support_pref:p3");
  });

  it("retries a 503 twice with growing, jittered waits, then succeeds", async () => {
    const { d } = await enabled();
    d.answers.push(json(503, {}), json(503, {}));
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "ok" });
    expect(d.calls).toHaveLength(3);
    expect(d.sleeps).toEqual([300, 600]);
  });

  it("honours Retry-After on a 429", async () => {
    const { d } = await enabled();
    d.answers.push(json(429, {}, { "retry-after": "2" }));
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "ok" });
    expect(d.sleeps).toEqual([2000]);
  });

  it("never retries a 4xx", async () => {
    const { d } = await enabled();
    d.answers.push(json(400, { error: { code: "bad_input" } }));
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "failed" });
    expect(d.calls).toHaveLength(1);
    expect(d.sleeps).toEqual([]);
  });

  it("network down: gives up after the last try as failed, loses nothing, and the next sync works", async () => {
    const { db, d } = await enabled();
    d.answers.push("throw", "throw", "throw");
    const before = d.state().persona.facts;
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "failed" });
    expect(d.calls).toHaveLength(3);
    expect(d.state().persona.facts).toEqual(before);
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "ok" });
    expect(stored(db)).toHaveLength(3);
  });

  it("an answer that is not the expected shape is a failure, not a success", async () => {
    const { d } = await enabled();
    d.answers.push(json(200, { saved: 3 }));
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "failed" });
  });

  it("a stored fact in the answer that fails the allowlist makes the answer a failure and nothing from it is kept", async () => {
    const { d } = await enabled();
    d.answers.push(json(200, { saved: 0, rejected: 0, facts: [{ kind: "support_pref", key: "free text", client_updated_at: T1 }] }));
    const before = d.state().persona.facts;
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "failed" });
    expect(d.state().persona.facts).toEqual(before);
  });

  it("a request the client itself cannot make valid is not sent (poisoned clock)", async () => {
    const { d } = await enabled();
    d.clock.at = "not a time";
    d.store.update((x) => void (x.supportCard = { id: "c", topQuestionIds: [], items: [preset("p3")] }));
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "failed" });
    expect(d.calls).toEqual([]);
  });

  it("consent revoked on the server mid-sync: writing stops, memory switches off here, and it is not reported as a failure", async () => {
    const { db, d } = await enabled();
    db.consent = false;
    d.store.update((x) => void (x.supportCard = { id: "c", topQuestionIds: [], items: [preset("p3")] }));
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "off" });
    expect(d.state().settings.memoryOptIn).toBe(false);
    expect(stored(db)).not.toContain("support_pref:p3");
    d.calls.length = 0;
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "off" });
    expect(d.calls).toEqual([]); // no more pushes
  });

  it("a 403 that is not about consent is a failure, and memory stays on", async () => {
    const { d } = await enabled();
    d.answers.push(json(403, { error: { code: "forbidden" } }));
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "failed" });
    expect(d.state().settings.memoryOptIn).toBe(true);
  });

  it("the sync flag off on the server: failed (503 is retried and then reported), local data untouched", async () => {
    const { d } = await enabled();
    d.flag.on = false;
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "failed" });
    expect(d.calls).toHaveLength(3);
    expect(d.state().persona.facts).toHaveLength(3);
  });

  it("two quick taps run one after another, never interleaved", async () => {
    const { db, d } = await enabled();
    db.delayMs = 5;
    const order: string[] = [];
    await Promise.all([
      d.actions.syncPersona().then(() => order.push("a")),
      d.actions.syncPersona().then(() => order.push("b")),
    ]);
    expect(order).toEqual(["a", "b"]);
    expect(stored(db)).toHaveLength(3);
  });
});

describe("two devices: last write wins", () => {
  const withHelp = (at: string, level: 0 | 1 | 2 | 3) => (d: ReturnType<typeof memoryDevice>) =>
    d.store.update((x) => void (x.sessions = [practice("s", at, { question: level })]));

  it("a stale device does not overwrite a newer fact, and it adopts the newer one", async () => {
    const db = fakeMemoryDb();
    const a = memoryDevice(db, { card: [], at: "2026-11-05T12:00:00.000Z" });
    const b = memoryDevice(db, { card: [], at: "2026-11-05T12:00:00.000Z" });
    withHelp(T2, 3)(a); // newer practice, on device A
    withHelp(T1, 0)(b); // older practice, on device B
    await a.actions.enableMemory();
    await b.actions.enableMemory();
    expect(db.rows.get("help_level:question")).toMatchObject({ level: 3, client_updated_at: T2 });
    expect(b.state().persona.facts.find((f) => f.id === "help_level:question")?.level).toBe(3);
  });

  it("a new device (no support card yet) takes what the account already holds", async () => {
    const db = fakeMemoryDb();
    const a = memoryDevice(db, { card: CARD });
    await a.actions.enableMemory();
    const fresh = memoryDevice(db);
    expect(await fresh.actions.enableMemory()).toEqual({ ok: true, remote: "ok" });
    expect(ids(fresh)).toEqual(["pacing:one_question", "support_pref:p1", "support_pref:p2"]);
  });

  it("a new device never deletes what another device saved", async () => {
    const db = fakeMemoryDb();
    await memoryDevice(db, { card: CARD }).actions.enableMemory();
    const fresh = memoryDevice(db);
    await fresh.actions.enableMemory();
    await fresh.actions.syncPersona();
    expect(stored(db)).toHaveLength(3);
  });

  it("turning a preference off removes it from the account, and a second device without a card does not bring it back", async () => {
    const db = fakeMemoryDb();
    const a = memoryDevice(db, { card: CARD });
    await a.actions.enableMemory();
    a.clock.at = T2;
    a.store.update((x) => void (x.supportCard = { id: "c", topQuestionIds: [], items: [preset("p1", false), preset("p2")] }));
    expect(await a.actions.syncPersona()).toMatchObject({ remote: "ok" });
    expect(stored(db)).toEqual(["pacing:one_question", "support_pref:p2"]);
    expect(a.state().persona.removed).toBeUndefined();
    expect(ids(a)).toEqual(["pacing:one_question", "support_pref:p2"]);
  });

  it("a removal made offline waits and is sent on the next good sync; a newer copy from another device survives it", async () => {
    const db = fakeMemoryDb();
    const a = memoryDevice(db, { card: CARD });
    await a.actions.enableMemory();
    a.auth.status = "offline";
    a.clock.at = "2026-11-05T10:30:00.000Z"; // between the first write and device B's newer one
    a.store.update((x) => void (x.supportCard = { id: "c", topQuestionIds: [], items: [preset("p2")] }));
    expect(await a.actions.syncPersona()).toMatchObject({ remote: "paused" });
    expect(a.state().persona.removed).toEqual([{ id: "support_pref:p1", at: "2026-11-05T10:30:00.000Z" }]);
    // Device B re-enabled p1 after A turned it off.
    db.rows.set("support_pref:p1", { kind: "support_pref", key: "p1", level: null, client_updated_at: T2 });
    a.auth.status = "ready";
    await a.actions.syncPersona();
    expect(stored(db)).toContain("support_pref:p1");
    expect(a.state().persona.removed).toBeUndefined();
  });

  it("a removal made while a sync is in flight is kept for the next sync", async () => {
    const db = fakeMemoryDb();
    const a = memoryDevice(db, { card: CARD });
    await a.actions.enableMemory();
    db.delayMs = 10;
    a.clock.at = T2;
    a.store.update((x) => void (x.supportCard = { id: "c", topQuestionIds: [], items: [preset("p2")] }));
    const syncing = a.actions.syncPersona();
    await new Promise((r) => setTimeout(r, 2));
    a.store.update((x) => void (x.persona.removed = [...(x.persona.removed ?? []), { id: "support_pref:p9", at: T2 }]));
    await syncing;
    expect(a.state().persona.removed?.map((r) => r.id)).toContain("support_pref:p9");
  });
});

describe("disableMemory", () => {
  it("revokes consent on the server first, then switches off; saved facts stay until deleted", async () => {
    const db = fakeMemoryDb();
    const d = memoryDevice(db, { card: CARD });
    await d.actions.enableMemory();
    expect(await d.actions.disableMemory()).toEqual({ ok: true, remote: "off" });
    expect(db.consent).toBe(false);
    expect(d.state().settings.memoryOptIn).toBe(false);
    expect(stored(db)).toHaveLength(3);
    d.calls.length = 0;
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "off" });
    expect(d.calls).toEqual([]);
  });

  it("if the server cannot be told, memory is still on there and must not look off here", async () => {
    const db = fakeMemoryDb();
    const d = memoryDevice(db, { card: CARD });
    await d.actions.enableMemory();
    d.answers.push("throw", "throw", "throw");
    expect(await d.actions.disableMemory()).toEqual({ ok: false, remote: "failed" });
    expect(d.state().settings.memoryOptIn).toBe(true);
    d.auth.status = "offline";
    expect(await d.actions.disableMemory()).toEqual({ ok: false, remote: "paused" });
    expect(d.state().settings.memoryOptIn).toBe(true);
  });

  it("already off: nothing to do and nothing sent", async () => {
    const d = memoryDevice(fakeMemoryDb(), { card: CARD });
    expect(await d.actions.disableMemory()).toEqual({ ok: true, remote: "off" });
    expect(d.calls).toEqual([]);
  });
});

describe("forgetAll and deleteEverything", () => {
  it("erases the account's copy, then clears facts here and switches memory off", async () => {
    const db = fakeMemoryDb();
    const d = memoryDevice(db, { card: CARD });
    await d.actions.enableMemory();
    expect(await d.actions.forgetAll()).toEqual({ remote: "ok" });
    expect(db.rows.size).toBe(0);
    expect(d.state().persona).toEqual({ facts: [] });
    expect(d.state().settings.memoryOptIn).toBe(false);
  });

  it("rows left on the server: failed, and the facts, the switch and the pending removals stay", async () => {
    const db = fakeMemoryDb();
    const d = memoryDevice(db, { card: CARD });
    await d.actions.enableMemory();
    db.stuckRows = 2;
    expect(await d.actions.forgetAll()).toEqual({ remote: "failed" });
    expect(d.state().persona.facts).toHaveLength(3);
    expect(d.state().settings.memoryOptIn).toBe(true);
  });

  it("memory switched off earlier does not stop the erase: what was saved is still deleted", async () => {
    const db = fakeMemoryDb();
    const d = memoryDevice(db, { card: CARD });
    await d.actions.enableMemory();
    await d.actions.disableMemory();
    expect(await d.actions.forgetAll()).toEqual({ remote: "ok" });
    expect(db.rows.size).toBe(0);
  });

  it("sign-in not ready on a device that saved facts: paused, nothing is cleared (an unproven erase is not an erase)", async () => {
    const db = fakeMemoryDb();
    const d = memoryDevice(db, { card: CARD });
    await d.actions.enableMemory();
    d.auth.status = "offline";
    expect(await d.actions.forgetAll()).toEqual({ remote: "paused" });
    expect(d.state().persona.facts).toHaveLength(3);
    expect(db.rows.size).toBe(3);
  });

  it("a device that never saved anything can clear itself without a network", async () => {
    const d = memoryDevice(fakeMemoryDb(), { auth: "degraded" });
    expect(await d.actions.forgetAll()).toEqual({ remote: "off" });
    expect(d.calls).toEqual([]);
  });

  it("deleteEverything resets the device only after the erase worked", async () => {
    const db = fakeMemoryDb();
    const d = memoryDevice(db, { card: CARD });
    await d.actions.enableMemory();
    db.stuckRows = 1;
    expect(await d.actions.deleteEverything()).toEqual({ status: "failed" });
    expect(d.storage.data.has(KEY)).toBe(true);
    d.auth.status = "offline";
    expect(await d.actions.deleteEverything()).toEqual({ status: "paused" });
    expect(d.storage.data.has(KEY)).toBe(true);
    d.auth.status = "ready";
    db.stuckRows = 0;
    expect(await d.actions.deleteEverything()).toEqual({ status: "ok" });
    expect(d.storage.data.has(KEY)).toBe(false);
    expect(db.rows.size).toBe(0);
  });

  it("deleteEverything reports failed when the device cannot be cleared", async () => {
    const d = memoryDevice(fakeMemoryDb(), { card: [] });
    d.storage.removeItem = () => {
      throw new Error("blocked");
    };
    expect(await d.actions.deleteEverything()).toEqual({ status: "failed" });
  });
});

describe("blocked or full storage", () => {
  it("a sync still reaches the server when this device cannot save, and nothing throws", async () => {
    const storage = fakeStorage();
    const store = createStateStore({ storage });
    store.hydrate();
    store.update((d) => void (d.supportCard = { id: "c", topQuestionIds: [], items: [preset("p1")] }));
    const actions = createMemoryActions({ store, fetchFn: (async () => json(200, { saved: 0, rejected: 0, facts: [] })) as typeof fetch, authStatus: () => "ready", now: () => T1 });
    store.update((d) => void (d.settings.memoryOptIn = true));
    storage.failWrites = new DOMException("full", "QuotaExceededError");
    await expect(actions.syncPersona()).resolves.toMatchObject({ remote: "ok" });
  });
});
