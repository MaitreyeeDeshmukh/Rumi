/**
 * localStorage access for the whole app. Reading never throws and never loses more than the one bad field.
 * Writing tells the caller what happened (a full disk is reported, not swallowed).
 */
import type { RumiState } from '@/features/shared/types';
import { MAX_SESSIONS, defaultSettings, defaultState, parseState } from './storage-schema';

export { MAX_SESSIONS, defaultSettings, defaultState };

export const KEY = 'rumi.v1';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type SaveResult = { ok: true } | { ok: false; reason: 'quota' | 'blocked' | 'unavailable' };

/** The browser's localStorage, or null on the server or when the browser blocks it. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadState(store: Pick<Storage, 'getItem'> | null = browserStorage()): RumiState {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return defaultState();
    return parseState(JSON.parse(raw));
  } catch {
    return defaultState(); // corrupt JSON or blocked storage: start clean, never a white screen
  }
}

const isQuota = (e: unknown): boolean => {
  const err = e as { name?: unknown; code?: unknown } | null;
  return err?.name === 'QuotaExceededError' || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err?.code === 22 || err?.code === 1014;
};

export function saveState(state: RumiState, store: StorageLike | null = browserStorage()): SaveResult {
  if (!store) return { ok: false, reason: 'unavailable' };
  try {
    store.setItem(KEY, JSON.stringify({ ...state, sessions: state.sessions.slice(-MAX_SESSIONS) }));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: isQuota(e) ? 'quota' : 'blocked' };
  }
}

export function resetState(store: StorageLike | null = browserStorage()): SaveResult {
  if (!store) return { ok: false, reason: 'unavailable' };
  try {
    store.removeItem(KEY);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'blocked' };
  }
}
