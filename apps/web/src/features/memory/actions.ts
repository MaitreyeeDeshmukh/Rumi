/**
 * Browser-side memory logic: turn memory on or off, sync the persona, forget everything.
 * Talks only to our own routes (/api/memory/facts and /api/memory/forget) through an injected fetch.
 * Rules it keeps:
 *  - nothing runs before the state is hydrated (every action answers `failed` until then), so an early call can
 *    never create a new code and roll back a stored one;
 *  - facts are always saved on the device; the network is touched only when memory is on;
 *  - a remote write needs a recovery code that can be read back from storage;
 *  - turning memory off never deletes anything remotely;
 *  - forget keeps the code, the switch and the facts until the server says `ok`;
 *  - "delete everything" calls forget whenever a code exists, and does not reset the device if forget failed;
 *  - calls run one after another, so two quick taps cannot interleave;
 *  - the time since the last remote write is sent with forget, so the server can wait for indexing to settle.
 * Two devices that share one recovery code are last-writer-wins: whichever syncs last decides the remote set.
 * That is the accepted rule; the code is a shared secret, not an account.
 */
import { FactsReply, ForgetReply } from '@/features/shared/schemas';
import type { RumiState } from '@/features/shared/types';
import type { StateStore } from '@/features/state/stateStore';
import { factsFromState, toWireFacts } from './persona';
import { isRecoveryCode, newRecoveryCode } from './recoveryCode';

export type RemoteStatus = 'off' | 'ok' | 'failed';
export type MemoryStore = Pick<StateStore, 'getSnapshot' | 'update' | 'reset' | 'verifiedRecoveryCode'>;

export interface MemoryActionDeps {
  store: MemoryStore;
  fetchFn: typeof fetch;
  /** ISO time stamp for new facts. */
  now?: () => string;
  /** Milliseconds clock, for "how long ago was the last sync". */
  clock?: () => number;
  timeoutMs?: number;
}

const FACTS_PATH = '/api/memory/facts';
const FORGET_PATH = '/api/memory/forget';
const MEMORY_HEADER = 'x-rumi-key';

/** The code to send with AI calls: only while memory is on and the code is valid. */
export const memoryCodeFor = (s: RumiState): string | undefined =>
  s.settings.memoryOptIn && s.persona.recoveryCode !== undefined && isRecoveryCode(s.persona.recoveryCode) ? s.persona.recoveryCode : undefined;

export function createMemoryActions({ store, fetchFn, now = () => new Date().toISOString(), clock = Date.now, timeoutMs = 25_000 }: MemoryActionDeps) {
  let tail: Promise<unknown> = Promise.resolve();
  let lastSyncAt: number | undefined;
  const inOrder = <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const state = (): RumiState => store.getSnapshot().state;
  const ready = (): boolean => store.getSnapshot().hydrated;

  /** POST JSON with the recovery code header. Returns the parsed body of a 2xx answer, otherwise null. Never throws. */
  async function post(path: string, code: string, body: unknown): Promise<unknown> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchFn(path, {
        method: 'POST',
        credentials: 'same-origin',
        signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', [MEMORY_HEADER]: code },
        body: JSON.stringify(body),
      });
      return res.ok ? await res.json().catch(() => null) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function doSync(): Promise<{ saved: number; remote: RemoteStatus }> {
    if (!ready()) return { saved: 0, remote: 'failed' };
    const stamp = now();
    store.update((d) => void (d.persona.facts = factsFromState(d, stamp)));
    const s = state();
    const saved = s.persona.facts.length;
    if (!s.settings.memoryOptIn) return { saved, remote: 'off' };
    const code = store.verifiedRecoveryCode();
    if (!code) return { saved, remote: 'failed' };
    const answer = await post(FACTS_PATH, code, { facts: toWireFacts(s.persona.facts) });
    lastSyncAt = clock(); // after the request, so even a lost answer counts as a recent write
    return { saved, remote: FactsReply.safeParse(answer).success ? 'ok' : 'failed' };
  }

  async function doEnable(): Promise<{ ok: boolean; remote: RemoteStatus }> {
    if (!ready()) return { ok: false, remote: 'failed' };
    const existing = state().persona.recoveryCode;
    const code = existing !== undefined && isRecoveryCode(existing) ? existing : newRecoveryCode();
    store.update((d) => {
      d.persona.recoveryCode = code;
      d.settings.memoryOptIn = true;
    });
    if (store.verifiedRecoveryCode() !== code) {
      // The code did not reach this device: switch off again rather than save to a place nobody can erase.
      store.update((d) => {
        d.settings.memoryOptIn = false;
        if (existing === undefined) delete d.persona.recoveryCode;
      });
      return { ok: false, remote: 'failed' };
    }
    return { ok: true, remote: (await doSync()).remote };
  }

  async function doForget(): Promise<{ remote: RemoteStatus }> {
    if (!ready()) return { remote: 'failed' };
    const code = state().persona.recoveryCode;
    if (code !== undefined && isRecoveryCode(code)) {
      const sinceSyncMs = lastSyncAt === undefined ? undefined : Math.max(0, clock() - lastSyncAt);
      const answer = await post(FORGET_PATH, code, sinceSyncMs === undefined ? {} : { sinceSyncMs });
      if (ForgetReply.safeParse(answer).data?.status !== 'ok') return { remote: 'failed' };
    }
    store.update((d) => {
      // Clear only what was erased: a newer code (made in another tab while the request ran) stays.
      if (d.persona.recoveryCode !== code) return;
      d.persona.facts = [];
      delete d.persona.recoveryCode;
      d.settings.memoryOptIn = false;
    });
    return { remote: code === undefined ? 'off' : 'ok' };
  }

  return {
    syncPersona: () => inOrder(doSync),
    enableMemory: () => inOrder(doEnable),
    /** Stops saving. Whatever is already saved stays until the person deletes it. */
    disableMemory: () =>
      inOrder(async (): Promise<{ ok: boolean }> => {
        if (!ready()) return { ok: false };
        store.update((d) => void (d.settings.memoryOptIn = false));
        return { ok: true };
      }),
    forgetAll: () => inOrder(doForget),
    /** "Delete everything": forget first (whenever a code exists), reset the device only if that worked. */
    deleteEverything: () =>
      inOrder(async (): Promise<{ status: 'ok' | 'failed' }> => {
        if ((await doForget()).remote === 'failed') return { status: 'failed' };
        return { status: store.reset().ok ? 'ok' : 'failed' };
      }),
  };
}

export type MemoryActions = ReturnType<typeof createMemoryActions>;
