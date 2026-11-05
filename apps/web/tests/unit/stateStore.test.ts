import { describe, expect, it, vi } from "vitest";
import { MAX_PENDING_UPDATES, createStateStore, type StorageEventLike } from "@/features/state/stateStore";
import { KEY, MAX_SESSIONS, defaultState, loadState, saveState } from "@/lib/storage";
import { fakeStorage } from "./helpers/fakeStorage";
import type { RumiState } from "@/features/shared/types";

const CODE = "ABCDE-FGHJK-LMNPQ-RSTUV";
const CODE2 = "ABCDE-FGHJK-LMNPQ-RSTUW";

function fakeEvents() {
  const listeners = new Set<(e: StorageEventLike) => void>();
  return {
    addEventListener: (_t: "storage", l: (e: StorageEventLike) => void) => void listeners.add(l),
    removeEventListener: (_t: "storage", l: (e: StorageEventLike) => void) => void listeners.delete(l),
    fire: (e: StorageEventLike) => listeners.forEach((l) => l(e)),
    count: () => listeners.size,
  };
}
const stored = (over: Partial<RumiState>): string => JSON.stringify({ ...defaultState(), ...over });
const session = (i: number) => ({ id: `s${i}`, planId: "plan-1", startedAt: "t", focus: "whole" as const, turns: [], coveredItemIds: [], helpCount: 0, helpLevelUsed: {} });

describe("stateStore before hydration", () => {
  it("starts as the default state, not hydrated, without touching storage", () => {
    const storage = fakeStorage({ [KEY]: stored({ settings: { ...defaultState().settings, name: "Sam" } }) });
    const getItem = vi.spyOn(storage, "getItem");
    const store = createStateStore({ storage });
    expect(store.getSnapshot().hydrated).toBe(false);
    expect(store.getSnapshot().state).toEqual(defaultState());
    expect(getItem).not.toHaveBeenCalled();
    expect(store.getServerSnapshot()).toBe(store.getServerSnapshot());
    expect(store.getServerSnapshot().hydrated).toBe(false);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it("an update before hydration is queued: storage is not written, and it is applied on top of the stored state", () => {
    const storage = fakeStorage({ [KEY]: stored({ settings: { ...defaultState().settings, finishSound: true } }) });
    const store = createStateStore({ storage });
    store.update((d) => void (d.settings.name = "Sam"));
    expect(storage.writes).toBe(0);
    expect(store.getSnapshot().state.settings.name).toBe("");
    store.hydrate();
    const s = store.getSnapshot();
    expect(s.hydrated).toBe(true);
    expect(s.state.settings).toMatchObject({ finishSound: true, name: "Sam" });
    expect(loadState(storage).settings).toMatchObject({ finishSound: true, name: "Sam" });
    expect(storage.writes).toBe(1);
  });

  it("never overwrites saved data with defaults when updates arrive before hydration", () => {
    const storage = fakeStorage({ [KEY]: stored({ settings: { ...defaultState().settings, name: "Sam" } }) });
    const store = createStateStore({ storage });
    store.update((d) => void (d.settings.finishSound = true));
    expect(JSON.parse(storage.data.get(KEY) as string).settings.name).toBe("Sam");
  });

  it("reset drops updates that were waiting for hydration", () => {
    const storage = fakeStorage();
    const store = createStateStore({ storage });
    store.update((d) => void (d.settings.name = "Sam"));
    store.reset();
    store.hydrate();
    expect(store.getSnapshot().state.settings.name).toBe("");
  });

  it("a broken queued update is skipped and the others still apply", () => {
    const store = createStateStore({ storage: fakeStorage() });
    store.update((d) => void (d.settings.name = "A"));
    store.update(() => {
      throw new Error("bug");
    });
    store.update((d) => void (d.settings.detail = "detailed"));
    store.hydrate();
    expect(store.getSnapshot().state.settings).toMatchObject({ name: "A", detail: "detailed" });
  });

  it("keeps at most the allowed number of queued updates", () => {
    let ran = 0;
    const probe = createStateStore({ storage: fakeStorage() });
    for (let i = 0; i < MAX_PENDING_UPDATES + 50; i++) probe.update(() => void ran++);
    probe.hydrate();
    expect(ran).toBe(MAX_PENDING_UPDATES);
  });
});

describe("stateStore after hydration", () => {
  it("update saves, notifies and never mutates the previous snapshot", () => {
    const storage = fakeStorage();
    const store = createStateStore({ storage });
    store.hydrate();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();
    store.update((d) => void (d.settings.name = "Sam"));
    const after = store.getSnapshot();
    expect(before.state.settings.name).toBe("");
    expect(after.state.settings.name).toBe("Sam");
    expect(after).not.toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(loadState(storage).settings.name).toBe("Sam");
  });

  it("unsubscribe stops notifications", () => {
    const store = createStateStore({ storage: fakeStorage() });
    store.hydrate();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    off();
    store.update((d) => void (d.settings.name = "x"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("caps sessions at 20 in memory and on disk", () => {
    const storage = fakeStorage();
    const store = createStateStore({ storage });
    store.hydrate();
    store.update((d) => void (d.sessions = Array.from({ length: 30 }, (_, i) => session(i))));
    expect(store.getSnapshot().state.sessions).toHaveLength(MAX_SESSIONS);
    expect(store.getSnapshot().state.sessions.at(-1)?.id).toBe("s29");
    expect(JSON.parse(storage.data.get(KEY) as string).sessions).toHaveLength(MAX_SESSIONS);
  });

  it("a full disk is reported in the snapshot while the app keeps working in memory", () => {
    const storage = fakeStorage();
    const store = createStateStore({ storage });
    store.hydrate();
    expect(store.getSnapshot().lastSave).toEqual({ ok: true });
    storage.failWrites = new DOMException("full", "QuotaExceededError");
    store.update((d) => void (d.settings.name = "Sam"));
    expect(store.getSnapshot().lastSave).toEqual({ ok: false, reason: "quota" });
    expect(store.getSnapshot().state.settings.name).toBe("Sam");
    storage.failWrites = null;
    store.update((d) => void (d.settings.name = "Sam2"));
    expect(store.getSnapshot().lastSave).toEqual({ ok: true });
  });

  it("a throwing update leaves the state as it was and rethrows", () => {
    const store = createStateStore({ storage: fakeStorage() });
    store.hydrate();
    expect(() =>
      store.update((d) => {
        d.settings.name = "half";
        throw new Error("bug");
      }),
    ).toThrow("bug");
    expect(store.getSnapshot().state.settings.name).toBe("");
  });

  it("reset clears storage and state and reports a blocked store", () => {
    const storage = fakeStorage();
    const store = createStateStore({ storage });
    store.hydrate();
    store.update((d) => void (d.settings.name = "Sam"));
    expect(store.reset()).toEqual({ ok: true });
    expect(storage.data.has(KEY)).toBe(false);
    expect(store.getSnapshot().state).toEqual(defaultState());
    const blocked = createStateStore({
      storage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });
    blocked.hydrate();
    expect(blocked.reset()).toEqual({ ok: false, reason: "blocked" });
  });

  it("hydrate runs once: a second start does not throw away unsaved in-memory changes", () => {
    const storage = fakeStorage();
    const events = fakeEvents();
    const store = createStateStore({ storage, events });
    const stop1 = store.start();
    storage.failWrites = new Error("blocked");
    store.update((d) => void (d.settings.name = "Sam"));
    stop1();
    store.start();
    expect(store.getSnapshot().state.settings.name).toBe("Sam");
  });
});

describe("stateStore storage events (other tabs)", () => {
  it("reloads when another tab changes the key, ignores other keys, reloads on clear", () => {
    const storage = fakeStorage();
    const events = fakeEvents();
    const store = createStateStore({ storage, events });
    store.start();
    const listener = vi.fn();
    store.subscribe(listener);

    const other = { ...defaultState(), settings: { ...defaultState().settings, name: "From tab B" } };
    saveState(other, storage);
    events.fire({ key: "something-else" });
    expect(store.getSnapshot().state.settings.name).toBe("");
    events.fire({ key: KEY });
    expect(store.getSnapshot().state.settings.name).toBe("From tab B");
    expect(listener).toHaveBeenCalledTimes(1);

    storage.data.clear();
    events.fire({ key: null });
    expect(store.getSnapshot().state).toEqual(defaultState());
  });

  it("listens only after start() and stops listening after stop()", () => {
    const storage = fakeStorage();
    const events = fakeEvents();
    const store = createStateStore({ storage, events });
    expect(events.count()).toBe(0);
    events.fire({ key: KEY });
    expect(store.getSnapshot().hydrated).toBe(false);
    const stop = store.start();
    expect(events.count()).toBe(1);
    stop();
    expect(events.count()).toBe(0);
  });
});

describe("stateStore.verifiedRecoveryCode", () => {
  const setCode = (code: string) => (d: RumiState) => void (d.persona.recoveryCode = code);

  it("is undefined before hydration, with no code, or with no storage", () => {
    const store = createStateStore({ storage: fakeStorage() });
    expect(store.verifiedRecoveryCode()).toBeUndefined();
    store.hydrate();
    expect(store.verifiedRecoveryCode()).toBeUndefined();
    const none = createStateStore({ storage: null });
    none.hydrate();
    none.update(setCode(CODE));
    expect(none.verifiedRecoveryCode()).toBeUndefined();
  });

  it("returns the code only when it can be read back from storage", () => {
    const storage = fakeStorage();
    const store = createStateStore({ storage });
    store.hydrate();
    store.update(setCode(CODE));
    expect(store.verifiedRecoveryCode()).toBe(CODE);
  });

  it("is undefined when the save failed, so no remote write can create an orphan namespace", () => {
    const storage = fakeStorage();
    const store = createStateStore({ storage });
    store.hydrate();
    storage.failWrites = new DOMException("full", "QuotaExceededError");
    store.update(setCode(CODE));
    expect(store.getSnapshot().state.persona.recoveryCode).toBe(CODE);
    expect(store.verifiedRecoveryCode()).toBeUndefined();
  });

  it("is undefined when another tab replaced or removed the code", () => {
    const storage = fakeStorage();
    const store = createStateStore({ storage });
    store.hydrate();
    store.update(setCode(CODE));
    const raw = JSON.parse(storage.data.get(KEY) as string);
    raw.persona.recoveryCode = CODE2;
    storage.data.set(KEY, JSON.stringify(raw));
    expect(store.verifiedRecoveryCode()).toBeUndefined();
    storage.data.delete(KEY);
    expect(store.verifiedRecoveryCode()).toBeUndefined();
  });

  it("is undefined for a code that is not valid", () => {
    const storage = fakeStorage();
    const store = createStateStore({ storage });
    store.hydrate();
    store.update(setCode(CODE + "\n"));
    expect(store.verifiedRecoveryCode()).toBeUndefined();
  });
});
