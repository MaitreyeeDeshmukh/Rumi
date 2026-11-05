/**
 * Browser-side memory logic: turn memory on or off, sync the persona, forget everything.
 * Talks only to our own routes (/api/memory/facts and /api/memory/forget) through an injected fetch.
 * Rules it keeps:
 *  - facts are always saved on the device; the network is touched only when memory is on;
 *  - a remote write needs a recovery code that can be read back from storage;
 *  - turning memory off never deletes anything remotely;
 *  - forget keeps the code, the switch and the facts until the server says `ok`;
 *  - "delete everything" calls forget whenever a code exists, and does not reset the device if forget failed;
 *  - calls run one after another, so two quick taps cannot interleave.
 */
import { FactsReply, ForgetReply } from '@/features/shared/schemas';
import type { RumiState } from '@/features/shared/types';
import type { SaveResult } from '@/lib/storage';
import type { StateStore } from '@/features/state/stateStore';
import { factsFromState, toWireFacts } from './persona';
import { isRecoveryCode, newRecoveryCode } from './recoveryCode';

export type RemoteStatus = 'off' | 'ok' | 'failed';
export type MemoryStore = Pick<StateStore, 'getSnapshot' | 'update' | 'reset' | 'verifiedRecoveryCode'>;

export interface MemoryActionDeps {
  store: MemoryStore;
  fetchFn: typeof fetch;
  now?: () => string;
  timeoutMs?: number;
}

const FACTS_PATH = '/api/memory/facts';
const FORGET_PATH = '/api/memory/forget';
const MEMORY_HEADER = 'x-rumi-key';

/** The code to send with AI calls: only while memory is on and the code is valid. */
export const memoryCodeFor = (s: RumiState): string | undefined =>
  s.settings.memoryOptIn && s.persona.recoveryCode !== undefined && isRecoveryCode(s.persona.recoveryCode) ? s.persona.recoveryCode : undefined;

export function createMemoryActions({ store, fetchFn, now = () => new Date().toISOString(), timeoutMs = 25_000 }: MemoryActionDeps) {
  let tail: Promise<unknown> = Promise.resolve();
  const inOrder = <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const state = (): RumiState => store.getSnapshot().state;

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
    const stamp = now();
    store.update((d) => void (d.persona.facts = factsFromState(d, stamp)));
    const s = state();
    const saved = s.persona.facts.length;
    if (!s.settings.memoryOptIn) return { saved, remote: 'off' };
    const code = store.verifiedRecoveryCode();
    if (!code) return { saved, remote: 'failed' };
    const answer = await post(FACTS_PATH, code, { facts: toWireFacts(s.persona.facts) });
    return { saved, remote: FactsReply.safeParse(answer).success ? 'ok' : 'failed' };
  }

  async function doEnable(): Promise<{ ok: boolean; remote: RemoteStatus }> {
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
    const code = state().persona.recoveryCode;
    if (code !== undefined && isRecoveryCode(code)) {
      if (ForgetReply.safeParse(await post(FORGET_PATH, code, {})).data?.status !== 'ok') return { remote: 'failed' };
    }
    store.update((d) => {
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
    disableMemory: () => inOrder(async () => store.update((d) => void (d.settings.memoryOptIn = false))),
    forgetAll: () => inOrder(doForget),
    /** "Delete everything": forget first (whenever a code exists), reset the device only if that worked. */
    deleteEverything: () =>
      inOrder(async (): Promise<{ status: 'ok' | 'failed' }> => {
        if ((await doForget()).remote === 'failed') return { status: 'failed' };
        const local: SaveResult = store.reset();
        return { status: local.ok ? 'ok' : 'failed' };
      }),
  };
}

export type MemoryActions = ReturnType<typeof createMemoryActions>;
