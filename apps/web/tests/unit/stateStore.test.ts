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

  it("reset before hydration discards waiting updates and leaves a clean hydrated state", () => {
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

describe("stateStore: updates that do not fit, nesting, reset", () => {
  it("the update after the queue is full is reported as dropped and counted, not lost silently", () => {
    const store = createStateStore({ storage: fakeStorage() });
    const results: string[] = [];
    for (let n = 0; n < MAX_PENDING_UPDATES + 2; n++) results.push(store.update((d) => void (d.settings.name = `n${n}`)));
    expect(results.filter((r) => r === "queued")).toHaveLength(MAX_PENDING_UPDATES);
    expect(results.slice(-2)).toEqual(["dropped", "dropped"]);
    expect(store.getSnapshot().droppedUpdates).toBe(2);
    store.hydrate();
    expect(store.getSnapshot().droppedUpdates).toBe(2);
    expect(store.getSnapshot().state.settings.name).toBe(`n${MAX_PENDING_UPDATES - 1}`);
    expect(store.update((d) => void (d.settings.name = "later"))).toBe("applied");
  });

  it("update() inside an update function throws a clear error and changes nothing", () => {
    const store = createStateStore({ storage: fakeStorage() });
    store.hydrate();
    expect(() => store.update(() => void store.update((d) => void (d.settings.name = "inner")))).toThrow(/inside an update/);
    expect(store.getSnapshot().state.settings.name).toBe("");
    expect(store.update((d) => void (d.settings.name = "after"))).toBe("applied");
    expect(store.getSnapshot().state.settings.name).toBe("after");
  });

  it("reset with a storage that refuses to remove keeps the state on screen and reports the failure", () => {
    const storage = fakeStorage();
    const store = createStateStore({ storage });
    store.hydrate();
    store.update((d) => void (d.settings.name = "keep"));
    storage.removeItem = () => {
      throw new Error("blocked");
    };
    expect(store.reset()).toEqual({ ok: false, reason: "blocked" });
    expect(store.getSnapshot().state.settings.name).toBe("keep");
    expect(store.getSnapshot().lastSave).toEqual({ ok: false, reason: "blocked" });
    expect(JSON.parse(storage.data.get(KEY) as string).settings.name).toBe("keep");
  });

  it("reset with no storage at all clears the in-memory state", () => {
    const store = createStateStore({ storage: null });
    store.hydrate();
    store.update((d) => void (d.settings.name = "x"));
    expect(store.reset()).toEqual({ ok: false, reason: "unavailable" });
    expect(store.getSnapshot().state.settings.name).toBe("");
  });
});

describe("stateStore: other tabs write bad or newer data", () => {
  function started() {
    const storage = fakeStorage();
    const events = fakeEvents();
    const store = createStateStore({ storage, events });
    store.start();
    return { storage, events, store };
  }

  it("a corrupt value from another tab does not blank this tab; the next save writes this tab's valid state back", () => {
    const { storage, events, store } = started();
    store.update((d) => void (d.settings.name = "Mine"));
    storage.data.set(KEY, "{not json");
    events.fire({ key: KEY });
    expect(store.getSnapshot().state.settings.name).toBe("Mine");
    store.update((d) => void (d.settings.finishSound = true));
    const saved = JSON.parse(storage.data.get(KEY) as string);
    expect(saved.settings).toMatchObject({ name: "Mine", finishSound: true });
  });

  it("a value without a version marker is ignored the same way", () => {
    const { storage, events, store } = started();
    store.update((d) => void (d.settings.name = "Mine"));
    storage.data.set(KEY, JSON.stringify({ settings: {} }));
    events.fire({ key: KEY });
    expect(store.getSnapshot().state.settings.name).toBe("Mine");
  });

  it("when the newer data is removed in another tab, this tab leaves read-only mode and shows the empty state", () => {
    const { storage, events, store } = started();
    store.update((d) => void (d.settings.name = "Mine"));
    storage.data.set(KEY, JSON.stringify({ version: 2 }));
    events.fire({ key: KEY });
    expect(store.getSnapshot().readOnly).toBe(true);
    storage.data.delete(KEY);
    events.fire({ key: null });
    expect(store.getSnapshot().readOnly).toBe(false);
    expect(store.getSnapshot().state).toEqual(defaultState());
    store.update((d) => void (d.settings.name = "Fresh"));
    expect(JSON.parse(storage.data.get(KEY) as string).settings.name).toBe("Fresh");
  });

  it("a newer app version in another tab makes this tab read-only: its data is never overwritten", () => {
    const { storage, events, store } = started();
    store.update((d) => void (d.settings.name = "Mine"));
    const future = JSON.stringify({ version: 2, plan: { keep: "me" } });
    storage.data.set(KEY, future);
    events.fire({ key: KEY });
    expect(store.getSnapshot().readOnly).toBe(true);
    expect(store.getSnapshot().state.settings.name).toBe("Mine");
    expect(store.update((d) => void (d.settings.name = "Still works"))).toBe("applied");
    expect(store.getSnapshot().state.settings.name).toBe("Still works");
    expect(storage.data.get(KEY)).toBe(future);
  });
});

describe("stateStore: data from a newer app version", () => {
  const future = JSON.stringify({ version: 2, plan: { keep: "me" } });

  it("hydrates read-only: the app works in memory, nothing is written, the blob stays byte for byte", () => {
    const storage = fakeStorage({ [KEY]: future });
    const store = createStateStore({ storage });
    store.hydrate();
    expect(store.getSnapshot().readOnly).toBe(true);
    expect(store.getSnapshot().state).toEqual(defaultState());
    store.update((d) => void (d.settings.finishSound = true));
    expect(store.getSnapshot().state.settings.finishSound).toBe(true);
    expect(store.getSnapshot().lastSave).toEqual({ ok: false, reason: "read_only" });
    expect(storage.data.get(KEY)).toBe(future);
    expect(storage.writes).toBe(0);
  });

  it("updates queued before hydration are not written either", () => {
    const storage = fakeStorage({ [KEY]: future });
    const store = createStateStore({ storage });
    store.update((d) => void (d.settings.name = "early"));
    store.hydrate();
    expect(store.getSnapshot().state.settings.name).toBe("early");
    expect(storage.data.get(KEY)).toBe(future);
  });

  it("a recovery code cannot be verified in read-only mode, so no remote write can start", () => {
    const store = createStateStore({ storage: fakeStorage({ [KEY]: future }) });
    store.hydrate();
    store.update((d) => void (d.persona.recoveryCode = "ABCDE-FGHJK-LMNPQ-RSTUV"));
    expect(store.verifiedRecoveryCode()).toBeUndefined();
  });

  it("an ordinary version 1 blob is not read-only", () => {
    const store = createStateStore({ storage: fakeStorage({ [KEY]: JSON.stringify(defaultState()) }) });
    store.hydrate();
    expect(store.getSnapshot().readOnly).toBe(false);
  });

  it("delete everything clears the newer data and leaves read-only mode", () => {
    const storage = fakeStorage({ [KEY]: future });
    const store = createStateStore({ storage });
    store.hydrate();
    expect(store.reset()).toEqual({ ok: true });
    expect(storage.data.has(KEY)).toBe(false);
    expect(store.getSnapshot().readOnly).toBe(false);
    store.update((d) => void (d.settings.name = "fresh"));
    expect(loadState(storage).settings.name).toBe("fresh");
  });
});
