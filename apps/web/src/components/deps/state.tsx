'use client';
/**
 * TEMPORARY stand-in for Sujal's `@/features/state` (useRumi, RumiProvider, loadState/saveState).
 * Same signature as contract 4.6. Delete this file and re-export from `@/features/state` in
 * `deps/index.ts` once lane/memory merges.
 */
import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import type { RumiState } from '@/features/shared/types';

export const STORAGE_KEY = 'rumi.v1';

export const DEFAULT_STATE: RumiState = {
  version: 1,
  settings: {
    name: '', companionName: 'Rumi', theme: 'soft', textScale: 1, reducedMotion: false,
    outputMode: 'read', detail: 'short', speechRate: 1, finishSound: false, memoryOptIn: false,
  },
  sessions: [],
  persona: { facts: [] },
};

function load(): RumiState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<RumiState>;
    if (parsed.version !== 1) return DEFAULT_STATE;
    return { ...DEFAULT_STATE, ...parsed, settings: { ...DEFAULT_STATE.settings, ...parsed.settings }, persona: parsed.persona ?? { facts: [] }, sessions: parsed.sessions ?? [] };
  } catch {
    return DEFAULT_STATE;
  }
}

let current: RumiState | null = null;
const listeners = new Set<() => void>();
const snapshot = (): RumiState => (current ??= load());
const subscribe = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const serverSnapshot = (): RumiState => DEFAULT_STATE;

function commit(next: RumiState): void {
  current = next;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage full or blocked: state stays in memory */ }
  listeners.forEach((l) => l());
}

const noop = (): (() => void) => () => {};

export function useRumi(): { state: RumiState; update: (fn: (draft: RumiState) => void) => void; reset: () => void; hydrated: boolean } {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const update = useCallback((fn: (draft: RumiState) => void) => {
    const draft = structuredClone(snapshot());
    fn(draft);
    commit(draft);
  }, []);
  const reset = useCallback(() => commit(structuredClone(DEFAULT_STATE)), []);
  return { state, update, reset, hydrated };
}

export function RumiProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
