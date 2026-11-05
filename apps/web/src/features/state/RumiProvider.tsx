'use client';

/**
 * Thin React wrapper over the framework-free store. The first render (server and client) is the default state,
 * so markup matches; storage is read in an effect, after mount.
 *
 * The component is built by `createRumiProvider(hooks)` so a test can hand it recording hooks and prove that the
 * effect which starts the store (hydrate + other-tab listener) is registered and cleans up. The exported
 * `RumiProvider` uses React's real hooks.
 */
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { RumiState } from '@/features/shared/types';
import { browserStorage, type SaveResult } from '@/lib/storage';
import { createStateStore, type Draft, type StateStore, type UpdateResult } from './stateStore';

const StoreContext = createContext<StateStore | null>(null);

export interface ProviderHooks {
  useState: <T>(init: () => T) => readonly [T, unknown];
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => void;
}

/** What the provider does after mount: start the store, stop it on unmount. */
export const startStoreEffect = (store: StateStore) => (): (() => void) => store.start();

export function createRumiProvider(hooks: ProviderHooks) {
  return function Provider({ children }: { children: ReactNode }) {
    const [store] = hooks.useState(() => createStateStore({ storage: browserStorage(), events: typeof window === 'undefined' ? null : window }));
    hooks.useEffect(startStoreEffect(store), [store]);
    return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
  };
}

export const RumiProvider = createRumiProvider({ useState, useEffect });

/** The store itself, for logic that needs `verifiedRecoveryCode()` (memory actions). */
export function useRumiStore(): StateStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useRumi outside RumiProvider');
  return store;
}

export interface RumiContext {
  state: RumiState;
  update: (fn: Draft) => UpdateResult;
  reset: () => SaveResult;
  hydrated: boolean;
  /** Result of the latest write. `{ ok: false }` means this device could not save (full disk, blocked, read-only). */
  lastSave: SaveResult;
  /** Storage holds data from a newer app version; nothing is saved until the person deletes it. */
  readOnly: boolean;
  /** Updates that arrived too early with a full queue and were not kept. */
  droppedUpdates: number;
}

export function useRumi(): RumiContext {
  const store = useRumiStore();
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return useMemo(
    () => ({
      state: snap.state,
      hydrated: snap.hydrated,
      lastSave: snap.lastSave,
      readOnly: snap.readOnly,
      droppedUpdates: snap.droppedUpdates,
      update: store.update,
      reset: store.reset,
    }),
    [snap, store],
  );
}
