/**
 * localStorage access for the whole app. Reading never throws and never loses more than the one bad field.
 * Writing tells the caller what happened (a full disk is reported, not swallowed).
 */
import type { RumiState } from '@/features/shared/types';
import { isRecoveryCode } from '@/features/memory/recoveryCode';
import { MAX_SESSIONS, defaultSettings, defaultState, parseState } from './storage-schema';

export { MAX_SESSIONS, defaultSettings, defaultState };

export const KEY = 'rumi.v1';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type SaveResult = { ok: true } | { ok: false; reason: 'quota' | 'blocked' | 'unavailable' | 'read_only' };

/**
 * What is in storage, as far as this version can tell:
 *  - missing: nothing saved (or no storage);
 *  - ok: a version 1 blob, parsed field by field;
 *  - corrupt: not JSON, not an object, or an unknown version marker;
 *  - future: a numeric version above 1, written by a newer app. It must be left untouched (read-only mode).
 *    The state is the default one, except that a valid persona.recoveryCode in the blob is read on a best-effort
 *    basis, so "delete everything" can still erase the remote copy before the blob is removed.
 */
export type StoredStatus = 'missing' | 'ok' | 'corrupt' | 'future';

/** The browser's localStorage, or null on the server or when the browser blocks it. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Best-effort read of persona.recoveryCode from a blob we do not understand. Only a valid code counts. */
function futureCode(parsed: unknown): string | undefined {
  const persona = typeof parsed === 'object' && parsed !== null ? (parsed as { persona?: unknown }).persona : undefined;
  const code = typeof persona === 'object' && persona !== null ? (persona as { recoveryCode?: unknown }).recoveryCode : undefined;
  return typeof code === 'string' && isRecoveryCode(code) ? code : undefined;
}

function withCode(state: RumiState, recoveryCode: string | undefined): RumiState {
  return recoveryCode ? { ...state, persona: { ...state.persona, recoveryCode } } : state;
}

export function inspectStorage(store: Pick<Storage, 'getItem'> | null = browserStorage()): { status: StoredStatus; state: RumiState } {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return { status: 'missing', state: defaultState() };
    const parsed: unknown = JSON.parse(raw);
    const version = typeof parsed === 'object' && parsed !== null ? (parsed as { version?: unknown }).version : undefined;
    if (typeof version === 'number' && version > 1) return { status: 'future', state: withCode(defaultState(), futureCode(parsed)) };
    if (version !== 1) return { status: 'corrupt', state: defaultState() };
    return { status: 'ok', state: parseState(parsed) };
  } catch {
    return { status: 'corrupt', state: defaultState() }; // corrupt JSON or blocked storage: never a white screen
  }
}

export const loadState = (store: Pick<Storage, 'getItem'> | null = browserStorage()): RumiState => inspectStorage(store).state;

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
