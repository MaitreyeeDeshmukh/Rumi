'use client';
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { defaultState, loadState, resetState, saveState } from '@/lib/storage';
import type { RumiState } from '@/features/shared/types';

export interface RumiCtx {
  state: RumiState;
  update: (fn: (draft: RumiState) => void) => void;
  reset: () => void;
  hydrated: boolean;
}

// One in-memory copy of the saved state for the whole tab. React reads it through
// useSyncExternalStore: during server render and hydration it gets SERVER (defaults),
// so the markup matches, then it re-renders with the real saved state.
const SERVER: RumiState = defaultState();
let current: RumiState | null = null;
const listeners = new Set<() => void>();

const getSnapshot = (): RumiState => (current ??= loadState());
const getServerSnapshot = (): RumiState => SERVER;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const publish = (next: RumiState) => { current = next; listeners.forEach((l) => l()); };

/** Applies fn to a copy of the latest state, saves it, then re-renders. Each call sees the previous call's result. */
function update(fn: (draft: RumiState) => void): void {
  const next = structuredClone(getSnapshot());
  fn(next);
  saveState(next);
  publish(next);
}

function reset(): void {
  resetState();
  publish(defaultState());
}

const noSubscribe = () => () => {};

export function RumiProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const value = useMemo(() => ({ state, update, reset, hydrated }), [state, hydrated]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const Ctx = createContext<RumiCtx | null>(null);

export function useRumi(): RumiCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRumi outside RumiProvider');
  return v;
}
