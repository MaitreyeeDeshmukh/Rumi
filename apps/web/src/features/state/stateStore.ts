/**
 * Framework-free browser state. React reads it through useSyncExternalStore (RumiProvider); everything here is
 * testable in node with a fake storage.
 *
 *  - Nothing is written before `hydrate()`: an early update() is queued and applied on top of what was stored,
 *    so a fast child can never overwrite saved data with defaults. The queue is capped; an update that does not
 *    fit is reported (`'dropped'` and `droppedUpdates`), never lost silently.
 *  - Every write reports its result in the snapshot (`lastSave`), so a full disk is visible.
 *  - A `storage` event (another tab changed the data) reloads the state, unless the new value is corrupt (this tab
 *    keeps what it has) or from a newer app version (this tab goes read-only).
 *  - Data written by a NEWER app version (numeric version above 1) is never overwritten: the store runs in
 *    read-only mode (`readOnly`), keeps working in memory and does not save. "Delete everything" still clears it.
 *  - `verifiedRecoveryCode()` reads the code back from storage; remote writes use it, so a code that did not
 *    reach this device (full disk, other tab) can never create a remote namespace nobody can erase.
 *  - An update function must not call update() itself (the inner change would be lost); that throws.
 */
import type { RumiState } from '@/features/shared/types';
import { KEY, MAX_SESSIONS, defaultState, inspectStorage, resetState, saveState, type SaveResult, type StorageLike } from '@/lib/storage';

export const MAX_PENDING_UPDATES = 100;

export interface StateSnapshot {
  state: RumiState;
  hydrated: boolean;
  lastSave: SaveResult;
  /** True when storage holds data from a newer app version. The store does not write while this is set. */
  readOnly: boolean;
  /** How many updates arrived before hydration with the queue already full and were not kept. */
  droppedUpdates: number;
}
export interface StorageEventLike {
  key: string | null;
}
export interface StorageEventTarget {
  addEventListener(type: 'storage', listener: (e: StorageEventLike) => void): void;
  removeEventListener(type: 'storage', listener: (e: StorageEventLike) => void): void;
}
export interface StateStoreDeps {
  storage: StorageLike | null;
  events?: StorageEventTarget | null;
}
export type Draft = (draft: RumiState) => void;
export type UpdateResult = 'applied' | 'queued' | 'dropped';

export interface StateStore {
  getSnapshot(): StateSnapshot;
  getServerSnapshot(): StateSnapshot;
  subscribe(listener: () => void): () => void;
  /** Loads storage once. Later calls do nothing. */
  hydrate(): void;
  /** Hydrates and listens for other tabs. Returns the stop function. */
  start(): () => void;
  update(fn: Draft): UpdateResult;
  /** Clears storage and state. If storage refuses (blocked), the state is kept and the failure is returned. */
  reset(): SaveResult;
  /** The recovery code, only if it is valid and stored on this device exactly as it is in memory. */
  verifiedRecoveryCode(): string | undefined;
}

const fresh = (): StateSnapshot => ({ state: defaultState(), hydrated: false, lastSave: { ok: true }, readOnly: false, droppedUpdates: 0 });
const SERVER_SNAPSHOT: StateSnapshot = fresh();

export function createStateStore({ storage, events = null }: StateStoreDeps): StateStore {
  let snapshot: StateSnapshot = fresh();
  let pending: Draft[] = [];
  let updating = false;
  const listeners = new Set<() => void>();

  const publish = (next: StateSnapshot): void => {
    snapshot = next;
    [...listeners].forEach((l) => l());
  };

  /** Runs one change on a copy, caps sessions, saves (unless read-only), and returns the new snapshot (not published). */
  function applied(from: StateSnapshot, fn: Draft): StateSnapshot {
    const next = structuredClone(from.state);
    updating = true;
    try {
      fn(next);
    } finally {
      updating = false;
    }
    next.sessions = next.sessions.slice(-MAX_SESSIONS);
    const lastSave: SaveResult = from.readOnly ? { ok: false, reason: 'read_only' } : saveState(next, storage);
    return { ...from, state: next, hydrated: true, lastSave };
  }

  function hydrate(): void {
    if (snapshot.hydrated) return;
    const stored = inspectStorage(storage);
    let current: StateSnapshot = { ...snapshot, state: stored.state, hydrated: true, readOnly: stored.status === 'future' };
    const queued = pending;
    pending = [];
    for (const fn of queued) {
      try {
        current = applied(current, fn);
      } catch {
        // a broken queued update is skipped; the rest still apply
      }
    }
    publish(current);
  }

  function update(fn: Draft): UpdateResult {
    if (updating) throw new Error('update() was called inside an update function; change the draft you were given instead');
    if (!snapshot.hydrated) {
      if (pending.length < MAX_PENDING_UPDATES) {
        pending.push(fn);
        return 'queued';
      }
      publish({ ...snapshot, droppedUpdates: snapshot.droppedUpdates + 1 });
      return 'dropped';
    }
    publish(applied(snapshot, fn));
    return 'applied';
  }

  const onStorage = (e: StorageEventLike): void => {
    if (e.key !== null && e.key !== KEY) return;
    const stored = inspectStorage(storage);
    // A corrupt value from another tab must not blank this one; the next save writes this tab's valid state back.
    if (stored.status === 'corrupt') return;
    if (stored.status === 'future') {
      publish({ ...snapshot, readOnly: true });
      return;
    }
    publish({ ...snapshot, state: stored.state, readOnly: false });
  };

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_SNAPSHOT,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    hydrate,
    start() {
      hydrate();
      events?.addEventListener('storage', onStorage);
      return () => events?.removeEventListener('storage', onStorage);
    },
    update,
    reset() {
      const result = resetState(storage);
      // removeItem threw: the data is still on the device, so the screen must not pretend it is gone.
      if (!result.ok && result.reason === 'blocked') {
        publish({ ...snapshot, lastSave: result });
        return result;
      }
      publish({ state: defaultState(), hydrated: true, lastSave: result, readOnly: false, droppedUpdates: snapshot.droppedUpdates });
      return result;
    },
    verifiedRecoveryCode() {
      const inMemory = snapshot.state.persona.recoveryCode;
      return inspectStorage(storage).state.persona.recoveryCode === inMemory ? inMemory : undefined;
    },
  };
}
