'use client';

/**
 * Thin React wrapper over the framework-free store. The first render (server and client) is the default state,
 * so markup matches; storage is read in an effect, after mount.
 */
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { RumiState } from '@/features/shared/types';
import { browserStorage, type SaveResult } from '@/lib/storage';
import { createStateStore, type Draft, type StateStore } from './stateStore';

const StoreContext = createContext<StateStore | null>(null);

export function RumiProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createStateStore({ storage: browserStorage(), events: typeof window === 'undefined' ? null : window }));
  useEffect(() => store.start(), [store]);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

/** The store itself, for logic that needs `verifiedRecoveryCode()` (memory actions). */
export function useRumiStore(): StateStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useRumi outside RumiProvider');
  return store;
}

export interface RumiContext {
  state: RumiState;
  update: (fn: Draft) => void;
  reset: () => SaveResult;
  hydrated: boolean;
  /** Result of the latest write. `{ ok: false }` means this device could not save (full disk or blocked). */
  lastSave: SaveResult;
}

export function useRumi(): RumiContext {
  const store = useRumiStore();
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return useMemo(
    () => ({ state: snap.state, hydrated: snap.hydrated, lastSave: snap.lastSave, update: store.update, reset: store.reset }),
    [snap, store],
  );
}
