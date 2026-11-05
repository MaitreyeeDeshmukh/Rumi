'use client';

/**
 * What the Settings screen and the support card use for memory. The logic is a small framework-free controller
 * (one per state store) so busy and status are shared by every component that calls the hook, and so it can be
 * tested without React. The actions run one after another (see actions.ts); `busy` is true while any is running.
 */
import { useSyncExternalStore } from 'react';
import type { PersonaFact, RumiState } from '@/features/shared/types';
import { useRumiStore } from '@/features/state/RumiProvider';
import type { StateStore } from '@/features/state/stateStore';
import { createMemoryActions, type MemoryActions } from './actions';
import { factStrings } from './factText';

/**
 * `failed`: a save did not reach the server.
 * `forget_failed`: an erase did not finish, so nothing was cleared on this device either. Saving stays paused until the
 *   person retries the erase, turns memory off, or wipes this device.
 * `local_only_wiped`: this device was cleared WITHOUT reaching the server, so a remote copy may still exist and the
 *   recovery code that could erase it is gone. The screen must say so.
 */
export type MemoryStatus = 'idle' | 'saved' | 'failed' | 'forget_failed' | 'local_only_wiped';

export interface MemoryControls {
  enabled: boolean;
  recoveryCode: string | undefined;
  facts: PersonaFact[];
  /** The sentences for `facts`, for a "What Rumi remembers" list (a fact carries no text of its own). */
  sentences: string[];
  busy: boolean;
  status: MemoryStatus;
  /** Turns memory on (makes a recovery code if there is none) and saves. true only when the server confirmed. */
  enable: () => Promise<boolean>;
  /** Stops saving. What is already saved stays until `forgetAll`. */
  disable: () => Promise<boolean>;
  /** Saves the current support sentences. Call after the support card is saved and after the practice summary. true unless a remote save failed. */
  sync: () => Promise<boolean>;
  /** Deletes the remote copy and clears the code and facts here. true only when the server confirmed. */
  forgetAll: () => Promise<boolean>;
  /** "Delete everything": erase remotely first, then reset this device. false (and nothing cleared) when the erase did not finish. */
  deleteEverything: () => Promise<boolean>;
  /**
   * The explicit way out when the server cannot be reached (routes off, offline): clears this device only, never
   * contacts the server. true when the device was cleared; status then becomes `local_only_wiped`.
   */
  wipeThisDevice: () => Promise<boolean>;
}

export interface MemoryController {
  subscribe(listener: () => void): () => void;
  getSnapshot(): MemoryControls;
  getServerSnapshot(): MemoryControls;
}

const view = (state: RumiState): Pick<MemoryControls, 'enabled' | 'recoveryCode' | 'facts' | 'sentences'> => ({
  enabled: state.settings.memoryOptIn,
  recoveryCode: state.persona.recoveryCode,
  facts: state.persona.facts,
  sentences: factStrings(state.persona.facts),
});

export function createMemoryController(store: StateStore, actions: MemoryActions): MemoryController {
  let busyCount = 0;
  let status: MemoryStatus = 'idle';
  const listeners = new Set<() => void>();
  const emit = (): void => [...listeners].forEach((l) => l());

  async function track(ok: MemoryStatus, bad: MemoryStatus, job: () => Promise<boolean>): Promise<boolean> {
    busyCount++;
    emit();
    let done = false;
    try {
      done = await job();
    } catch {
      done = false; // the actions never throw; this keeps `busy` from sticking if one ever does
    }
    busyCount--;
    status = done ? ok : bad;
    emit();
    return done;
  }

  /** Set when an erase did not finish. While it is set nothing is uploaded and the `forget_failed` status stays. */
  let eraseFailed = false;
  /** Runs an erase-type job and keeps `eraseFailed` in step with its result. */
  const erase = async (ok: MemoryStatus, job: () => Promise<boolean>): Promise<boolean> => {
    const done = await track(ok, 'forget_failed', job);
    eraseFailed = !done;
    return done;
  };

  const enable = (): Promise<boolean> => (eraseFailed ? Promise.resolve(false) : track('saved', 'failed', async () => (await actions.enableMemory()).remote === 'ok'));
  const disable = async (): Promise<boolean> => {
    const done = await track('idle', 'failed', async () => (await actions.disableMemory()).ok);
    if (done) eraseFailed = false;
    return done;
  };
  const sync = (): Promise<boolean> => (eraseFailed ? Promise.resolve(false) : track('saved', 'failed', async () => (await actions.syncPersona()).remote !== 'failed'));
  const forgetAll = () => erase('idle', async () => (await actions.forgetAll()).remote !== 'failed');
  const deleteEverything = () => erase('idle', async () => (await actions.deleteEverything()).status === 'ok');
  const wipeThisDevice = () => erase('local_only_wiped', async () => (await actions.wipeThisDevice()).status === 'ok');
  const handlers = { enable, disable, sync, forgetAll, deleteEverything, wipeThisDevice };

  let cache: { from: ReturnType<StateStore['getSnapshot']>; busy: boolean; status: MemoryStatus; value: MemoryControls } | null = null;
  const getSnapshot = (): MemoryControls => {
    const from = store.getSnapshot();
    const busy = busyCount > 0;
    if (cache && cache.from === from && cache.busy === busy && cache.status === status) return cache.value;
    const value: MemoryControls = { ...view(from.state), busy, status, ...handlers };
    cache = { from, busy, status, value };
    return value;
  };
  const server: MemoryControls = { ...view(store.getServerSnapshot().state), busy: false, status: 'idle', ...handlers };

  return {
    subscribe(listener) {
      listeners.add(listener);
      const stop = store.subscribe(listener);
      return () => {
        listeners.delete(listener);
        stop();
      };
    },
    getSnapshot,
    getServerSnapshot: () => server,
  };
}

/** One controller per store, so two components never run two sets of actions against the same data. */
const controllers = new WeakMap<StateStore, MemoryController>();

export function useMemoryControls(): MemoryControls {
  const store = useRumiStore();
  let controller = controllers.get(store);
  if (!controller) {
    controller = createMemoryController(store, createMemoryActions({ store, fetchFn: (input, init) => fetch(input, init) }));
    controllers.set(store, controller);
  }
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
}
