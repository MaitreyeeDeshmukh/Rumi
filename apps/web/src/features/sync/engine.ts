/**
 * The sync loop for one browser. Framework-free, so it runs in node with fakes.
 *
 * Local state stays the offline cache and the screens never wait for the network. With sync on and an email account signed in:
 *   - signing in (and "Sync now", and coming back to the tab) pulls, applies the newer changes, then pushes what the server lacks;
 *   - every change on the device is noticed at once (so its change time is the real one) and pushed after a short pause;
 *   - last write wins per record on the person's change time (merge.ts).
 * Rules it keeps: runs one job at a time; a failed job never loses anything (the marks stay "not sent" and the next run
 * retries, with a growing pause, three times); consent taken back elsewhere switches sync off here; the server's kill switch
 * only pauses; a different account than last time starts with fresh marks and sync off until that account's consent is read.
 */
import type { StateStore } from '@/features/state/stateStore';
import { emptyMeta, markPushed, pending, reconcile, stamp, type SyncMeta } from './merge';
import { clearMeta, saveMeta, type MetaStorage } from './meta';
import type { Result, SyncFailure, SyncRepository } from './types';

/** off: sync is not on. signed_out: on, but nobody (or only a guest) is signed in. */
export type SyncPhase = 'off' | 'signed_out' | 'idle' | 'syncing' | 'paused' | 'offline' | 'error';
export interface SyncStatus {
  phase: SyncPhase;
  /** Sync is on for this account. */
  on: boolean;
  /** ms since 1970 of the last run that finished, or null. */
  lastSyncedAt: number | null;
}

export interface SyncEngineDeps {
  store: Pick<StateStore, 'getSnapshot' | 'update' | 'subscribe'>;
  repo: SyncRepository;
  storage: MetaStorage | null;
  initialMeta: SyncMeta;
  now?: () => number;
  /** Pause after a change before it is sent. */
  debounceMs?: number;
  /** Test hooks. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

const RETRY_MS = [15_000, 60_000, 300_000];

export function createSyncEngine(deps: SyncEngineDeps) {
  const { store, repo, storage, now = Date.now, debounceMs = 2000 } = deps;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));

  let meta = deps.initialMeta;
  let userId: string | null = null;
  let busy = false;
  let applying = false;
  let timer: unknown = null;
  let failures = 0;
  let status: SyncStatus = { phase: meta.on ? 'signed_out' : 'off', on: meta.on, lastSyncedAt: null };
  const listeners = new Set<() => void>();
  let tail: Promise<unknown> = Promise.resolve();

  const inOrder = <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
  const publish = (patch: Partial<SyncStatus>): void => {
    status = { ...status, ...patch };
    [...listeners].forEach((l) => l());
  };
  const persist = (): void => void saveMeta(storage, meta);
  const setMeta = (next: SyncMeta): void => {
    if (next === meta) return;
    meta = next;
    persist();
  };
  const hydrated = (): boolean => store.getSnapshot().hydrated;
  const idlePhase = (): SyncPhase => (!meta.on ? 'off' : userId === null ? 'signed_out' : 'idle');

  function cancelTimer(): void {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function schedule(ms: number): void {
    cancelTimer();
    timer = setTimer(() => {
      timer = null;
      void syncNow();
    }, ms);
  }

  /** How a failed call changes the status. Returns true when the job should stop. */
  function onFailure(reason: SyncFailure): void {
    if (reason === 'consent') {
      setMeta({ ...meta, on: false });
      publish({ phase: 'off', on: false });
    } else if (reason === 'paused') {
      publish({ phase: 'paused' });
    } else if (reason === 'auth' || reason === 'account') {
      publish({ phase: 'signed_out' });
    } else {
      publish({ phase: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error' });
      if (failures < RETRY_MS.length) schedule(RETRY_MS[failures++]);
    }
  }

  async function run(): Promise<boolean> {
    if (!meta.on || userId === null || !hydrated()) return false;
    publish({ phase: 'syncing' });
    setMeta(stamp(store.getSnapshot().state, meta, now()));

    const pulled = await repo.pull();
    if (!pulled.ok) {
      onFailure(pulled.reason);
      return false;
    }
    // Stamp again: the person may have edited while the pull ran. Then apply, in one step with nothing in between.
    setMeta(stamp(store.getSnapshot().state, meta, now()));
    const result = reconcile(store.getSnapshot().state, meta, pulled.data);
    if (result.changed) {
      applying = true;
      try {
        store.update((d) => {
          if (result.state.appointments) d.appointments = result.state.appointments;
          else delete d.appointments;
          if (result.state.chats) d.chats = result.state.chats;
          else delete d.chats;
        });
      } finally {
        applying = false;
      }
    }
    setMeta(result.meta);

    const todo = pending(store.getSnapshot().state, meta);
    for (const batch of todo.batches) {
      const sent = await repo.push(batch);
      if (!sent.ok) {
        onFailure(sent.reason);
        return false;
      }
    }
    setMeta(markPushed(meta, todo.sent));
    failures = 0;
    publish({ phase: 'idle', lastSyncedAt: now() });
    return true;
  }

  /** One run that never throws. Call it from inside the queue (attach) or through syncNow. */
  async function safeRun(): Promise<boolean> {
    busy = true;
    try {
      return await run();
    } catch {
      onFailure('failed');
      return false;
    } finally {
      busy = false;
    }
  }
  const syncNow = (): Promise<boolean> => (busy ? Promise.resolve(false) : inOrder(safeRun));

  // Every change is noticed right away (cheap), and sent after a short pause.
  store.subscribe(() => {
    if (applying || !meta.on || userId === null || !hydrated()) return;
    const next = stamp(store.getSnapshot().state, meta, now());
    if (next === meta) return;
    setMeta(next);
    schedule(debounceMs);
  });

  return {
    getStatus: (): SyncStatus => status,
    subscribe(l: () => void): () => void {
      listeners.add(l);
      return () => void listeners.delete(l);
    },

    /**
     * The signed-in email account (or null for nobody / a guest). Reads the account's consent from the server; a different
     * account than last time starts clean. If sync is on, runs one sync.
     */
    attach(id: string | null): Promise<void> {
      return inOrder(async () => {
        cancelTimer();
        userId = id;
        if (id === null) {
          publish({ phase: idlePhase() });
          return;
        }
        if (meta.userId !== id) setMeta(emptyMeta(id));
        const consent = await repo.getConsent();
        if (!consent.ok) {
          // The server could not be asked: keep what was known. Sync was off, or a retry is already planned by onFailure.
          if (consent.reason === 'failed' && !meta.on) publish({ phase: 'off' });
          else onFailure(consent.reason);
          return;
        }
        if (consent.data.granted !== meta.on) setMeta({ ...meta, on: consent.data.granted });
        publish({ on: meta.on, phase: idlePhase() });
        if (meta.on) await safeRun();
      });
    },

    syncNow,

    /** Asks the server for consent, then syncs once. The caller shows the plain consent text before calling this. */
    enable(): Promise<Result<null>> {
      return inOrder(async () => {
        if (userId === null) return { ok: false, reason: 'account' } as const;
        const res = await repo.setConsent(true);
        if (!res.ok) return res;
        setMeta({ ...meta, userId, on: true });
        publish({ on: true, phase: 'idle' });
        void syncNow();
        return { ok: true, data: null } as const;
      });
    },

    /** Stops sending and reading. What is already in the cloud stays there until `deleteCloudCopy`. */
    disable(): Promise<Result<null>> {
      return inOrder(async () => {
        cancelTimer();
        if (userId !== null) {
          const res = await repo.setConsent(false);
          if (!res.ok) return res;
        }
        setMeta({ ...meta, on: false });
        publish({ on: false, phase: 'off' });
        return { ok: true, data: null } as const;
      });
    },

    /** Erases the cloud copy (rows and files) and turns sync off. This device keeps its own data. */
    deleteCloudCopy(): Promise<Result<null>> {
      return inOrder(async () => {
        cancelTimer();
        if (userId === null) return { ok: false, reason: 'auth' } as const;
        const res = await repo.forget();
        if (!res.ok) return res;
        meta = emptyMeta(userId);
        clearMeta(storage);
        publish({ on: false, phase: 'off', lastSyncedAt: null });
        return { ok: true, data: null } as const;
      });
    },

    /** Forgets the marks on this device only (after "Delete everything" cleared the state). */
    forgetMarks(): void {
      cancelTimer();
      meta = emptyMeta(userId ?? '');
      clearMeta(storage);
      publish({ on: false, phase: 'off', lastSyncedAt: null });
    },
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
