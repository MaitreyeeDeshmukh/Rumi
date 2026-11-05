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

/** `failed`: a save did not reach the server. `forget_failed`: an erase did not finish, so nothing was cleared on this device either. */
export type MemoryStatus = 'idle' | 'saved' | 'failed' | 'forget_failed';

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

  const enable = () => track('saved', 'failed', async () => (await actions.enableMemory()).remote === 'ok');
  const disable = () => track('idle', 'failed', async () => (await actions.disableMemory()).ok);
  const sync = () => track('saved', 'failed', async () => (await actions.syncPersona()).remote !== 'failed');
  const forgetAll = () => track('idle', 'forget_failed', async () => (await actions.forgetAll()).remote !== 'failed');
  const deleteEverything = () => track('idle', 'forget_failed', async () => (await actions.deleteEverything()).status === 'ok');
  const handlers = { enable, disable, sync, forgetAll, deleteEverything };

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
