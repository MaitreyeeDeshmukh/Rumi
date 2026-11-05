/**
 * Framework-free browser state. React reads it through useSyncExternalStore (RumiProvider); everything here is
 * testable in node with a fake storage.
 *
 *  - Nothing is written before `hydrate()`: an early update() is queued and applied on top of what was stored,
 *    so a fast child can never overwrite saved data with defaults.
 *  - Every write reports its result in the snapshot (`lastSave`), so a full disk is visible.
 *  - A `storage` event (another tab changed the data) reloads the state.
 *  - `verifiedRecoveryCode()` reads the code back from storage; remote writes use it, so a code that did not
 *    reach this device (full disk, other tab) can never create a remote namespace nobody can erase.
 */
import { isRecoveryCode } from '@/features/memory/recoveryCode';
import type { RumiState } from '@/features/shared/types';
import { KEY, MAX_SESSIONS, defaultState, loadState, resetState, saveState, type SaveResult, type StorageLike } from '@/lib/storage';

export const MAX_PENDING_UPDATES = 100;

export interface StateSnapshot {
  state: RumiState;
  hydrated: boolean;
  lastSave: SaveResult;
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

export interface StateStore {
  getSnapshot(): StateSnapshot;
  getServerSnapshot(): StateSnapshot;
  subscribe(listener: () => void): () => void;
  /** Loads storage once. Later calls do nothing. */
  hydrate(): void;
  /** Hydrates and listens for other tabs. Returns the stop function. */
  start(): () => void;
  update(fn: Draft): void;
  reset(): SaveResult;
  /** The recovery code, only if it is valid and stored on this device exactly as it is in memory. */
  verifiedRecoveryCode(): string | undefined;
}

const SERVER_SNAPSHOT: StateSnapshot = { state: defaultState(), hydrated: false, lastSave: { ok: true } };

export function createStateStore({ storage, events = null }: StateStoreDeps): StateStore {
  let snapshot: StateSnapshot = { state: defaultState(), hydrated: false, lastSave: { ok: true } };
  let pending: Draft[] = [];
  const listeners = new Set<() => void>();

  const publish = (next: StateSnapshot): void => {
    snapshot = next;
    [...listeners].forEach((l) => l());
  };

  /** Runs one change on a copy, caps sessions, saves, and returns the new snapshot (not published yet). */
  function applied(from: StateSnapshot, fn: Draft): StateSnapshot {
    const next = structuredClone(from.state);
    fn(next);
    next.sessions = next.sessions.slice(-MAX_SESSIONS);
    return { state: next, hydrated: true, lastSave: saveState(next, storage) };
  }

  function hydrate(): void {
    if (snapshot.hydrated) return;
    let current: StateSnapshot = { state: loadState(storage), hydrated: true, lastSave: { ok: true } };
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

  function update(fn: Draft): void {
    if (!snapshot.hydrated) {
      if (pending.length < MAX_PENDING_UPDATES) pending.push(fn);
      return;
    }
    publish(applied(snapshot, fn));
  }

  const onStorage = (e: StorageEventLike): void => {
    if (e.key !== null && e.key !== KEY) return;
    publish({ ...snapshot, state: loadState(storage) });
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
      pending = [];
      publish({ state: defaultState(), hydrated: true, lastSave: result });
      return result;
    },
    verifiedRecoveryCode() {
      const inMemory = snapshot.state.persona.recoveryCode;
      if (!inMemory || !isRecoveryCode(inMemory)) return undefined;
      return loadState(storage).persona.recoveryCode === inMemory ? inMemory : undefined;
    },
  };
}
