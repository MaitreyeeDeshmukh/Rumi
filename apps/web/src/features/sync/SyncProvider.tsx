'use client';

/**
 * Starts the sync engine for the app screens and shares it. Nothing runs until the person is signed in with an email account
 * and the store is hydrated; a guest or a signed-out visitor never touches the network from here.
 * It also syncs when the tab comes back or the network returns (at most once every 30 seconds).
 */
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useRumiStore } from '@/features/state/RumiProvider';
import { browserStorage } from '@/lib/storage';
import { createHttpDocumentStore, createHttpRepository } from './client';
import { createSyncEngine, type SyncEngine, type SyncStatus } from './engine';
import { loadMeta } from './meta';
import type { DocumentStore } from './types';

interface SyncValue {
  engine: SyncEngine;
  documents: DocumentStore;
}
const SyncContext = createContext<SyncValue | null>(null);
const MIN_GAP_MS = 30_000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const store = useRumiStore();
  const { status, userId, isAnonymous } = useAuth();
  const [value] = useState<SyncValue>(() => {
    const fetchFn: typeof fetch = (input, init) => fetch(input, init);
    const storage = browserStorage();
    return {
      engine: createSyncEngine({ store, repo: createHttpRepository(fetchFn), storage, initialMeta: loadMeta(storage) }),
      documents: createHttpDocumentStore(fetchFn),
    };
  });
  const { engine } = value;
  const account = status === 'ready' && !isAnonymous ? userId : null;

  useEffect(() => {
    void engine.attach(account);
  }, [engine, account]);

  useEffect(() => {
    let last = 0;
    const poke = (): void => {
      if (document.visibilityState === 'hidden' || Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      void engine.syncNow();
    };
    document.addEventListener('visibilitychange', poke);
    window.addEventListener('online', poke);
    return () => {
      document.removeEventListener('visibilitychange', poke);
      window.removeEventListener('online', poke);
    };
  }, [engine]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export interface SyncControls {
  status: SyncStatus;
  /** A signed-in email account is present, so sync can be turned on. */
  available: boolean;
  engine: SyncEngine;
  /** The original files of appointment documents (upload, link, remove). */
  documents: DocumentStore;
}

export function useSync(): SyncControls {
  const v = useContext(SyncContext);
  if (!v) throw new Error('useSync outside SyncProvider');
  const { status: auth, isAnonymous } = useAuth();
  const status = useSyncExternalStore(v.engine.subscribe, v.engine.getStatus, v.engine.getStatus);
  return useMemo(() => ({ status, available: auth === 'ready' && !isAnonymous, engine: v.engine, documents: v.documents }), [status, auth, isAnonymous, v]);
}
