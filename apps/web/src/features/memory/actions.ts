/**
 * Browser-side memory logic: turn memory on or off, sync the persona, forget everything.
 * Talks only to our own routes (/api/memory/*) through an injected fetch.
 * Rules it keeps:
 *  - nothing runs before the state is hydrated (every action answers `failed` until then);
 *  - facts are always saved on the device; the network is touched only when memory is on AND sign-in is `ready`
 *    (turning memory on, or syncing with it on, first asks for sign-in through `ensureSignedIn`; nothing else does);
 *  - local state is the source of truth: a sync that cannot finish loses nothing, and the next one retries;
 *  - a write is retried with growing, jittered waits only for faults that may clear (network, 5xx, 429), never for a 4xx,
 *    and Retry-After is honoured;
 *  - last write wins per fact on its change time; a stored fact that is newer replaces the local copy;
 *  - when the server says consent is off (turned off on another device), writing stops, memory switches off here
 *    and no error is shown: that is not a failure;
 *  - turning memory off first revokes consent on the server, so the server stops reading and accepting facts;
 *    if that cannot be done, memory stays on and the answer says so;
 *  - forget keeps the facts and the switch until the server says `ok`; with sign-in not ready it says `paused`, because
 *    an erasure nobody proved is not an erasure;
 *  - calls run one after another, so two quick taps cannot interleave.
 */
import { FactsReply, ForgetReply } from '@/features/shared/schemas';
import type { RumiState } from '@/features/shared/types';
import type { StateStore } from '@/features/state/stateStore';
import { factsFromState, mergeRemote, pendingRemovals, toSyncFacts, toWireRemovals } from './persona';
import { parseFactBatch } from './sanitize';

/** `paused`: sign-in is not ready, so nothing was sent. The facts are safe on this device. */
export type RemoteStatus = 'off' | 'ok' | 'failed' | 'paused';
export type LocalStore = Pick<StateStore, 'getSnapshot' | 'update' | 'reset'>;
export type AuthStatus = 'signing_in' | 'signed_out' | 'ready' | 'degraded' | 'offline';

export interface MemoryActionDeps {
  store: LocalStore;
  fetchFn: typeof fetch;
  /** The sign-in state right now. Remote calls start only when it is `ready`. A screen keeps it current with `setAuthStatus`. */
  authStatus?: () => AuthStatus;
  /**
   * Signs in anonymously when nobody is signed in yet, and answers with the state afterwards. Called only by a call that needs
   * the cloud (turning memory on, a sync with memory on), never on load. Without it those calls stay `paused` until sign-in is ready.
   */
  ensureSignedIn?: () => Promise<AuthStatus>;
  /** ISO time stamp for new facts. */
  now?: () => string;
  timeoutMs?: number;
  /** Tries per remote call, first one included. Default 3. */
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 0 to 1, for the retry wait. */
  random?: () => number;
}

const FACTS_PATH = '/api/memory/facts';
const FORGET_PATH = '/api/memory/forget';
const CONSENT_PATH = '/api/memory/consent';
const BASE_WAIT_MS = 400;
const MAX_WAIT_MS = 8000;

type Answer = { kind: 'ok'; data: unknown } | { kind: 'consent_off' } | { kind: 'failed' };

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Seconds from a Retry-After header, as ms, capped. Missing or not a number: undefined. */
function retryAfterMs(res: Response): number | undefined {
  const sec = Number(res.headers.get('retry-after'));
  return Number.isFinite(sec) && sec > 0 ? Math.min(sec * 1000, MAX_WAIT_MS) : undefined;
}

export function createMemoryActions({
  store,
  fetchFn,
  authStatus = () => 'signing_in',
  ensureSignedIn,
  now = () => new Date().toISOString(),
  timeoutMs = 25_000,
  attempts = 3,
  sleep = realSleep,
  random = Math.random,
}: MemoryActionDeps) {
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
  const ready = (): boolean => store.getSnapshot().hydrated;
  let pushed: AuthStatus | undefined;
  const online = (): boolean => (pushed ?? authStatus()) === 'ready';
  /** True when sign-in is ready, asking for it first if it is not. Never throws. */
  async function goOnline(): Promise<boolean> {
    if (online()) return true;
    if (ensureSignedIn === undefined) return false;
    try {
      pushed = await ensureSignedIn();
    } catch {
      return false;
    }
    return online();
  }

  /** POST JSON. Never throws. Retries only faults that may clear; a 4xx ends it at once. */
  async function post(path: string, body: unknown): Promise<Answer> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      let wait: number | undefined;
      try {
        const res = await fetchFn(path, {
          method: 'POST',
          credentials: 'same-origin',
          signal: ctl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) return { kind: 'ok', data: await res.json().catch(() => null) };
        if (res.status === 403 && ((await res.json().catch(() => null)) as { error?: { code?: unknown } } | null)?.error?.code === 'consent_required') {
          return { kind: 'consent_off' };
        }
        if (res.status !== 429 && res.status < 500) return { kind: 'failed' };
        wait = retryAfterMs(res);
      } catch {
        // Network down or the request timed out: the same as a 5xx, so it is retried below and then reported as failed.
      } finally {
        clearTimeout(timer);
      }
      if (attempt < attempts) {
        await sleep(wait ?? Math.min(BASE_WAIT_MS * 2 ** (attempt - 1), MAX_WAIT_MS) * (0.5 + random() / 2));
      }
    }
    return { kind: 'failed' };
  }

  async function doSync(): Promise<{ saved: number; remote: RemoteStatus }> {
    if (!ready()) return { saved: 0, remote: 'failed' };
    const stamp = now();
    store.update((d) => {
      const facts = factsFromState(d, stamp);
      d.persona.removed = pendingRemovals(d.persona, facts, d.supportCard !== undefined, stamp);
      if (d.persona.removed.length === 0) delete d.persona.removed;
      d.persona.facts = facts;
    });
    const s = state();
    const saved = s.persona.facts.length;
    if (!s.settings.memoryOptIn) return { saved, remote: 'off' };
    if (!(await goOnline())) return { saved, remote: 'paused' };

    const removed = toWireRemovals(s.persona.removed ?? [], stamp);
    const body = { facts: toSyncFacts(s.persona.facts), removed };
    // The same check the server runs. A batch that fails it is a bug here, so it is not sent and not trimmed.
    if (!parseFactBatch(body).ok) return { saved, remote: 'failed' };

    const answer = await post(FACTS_PATH, body);
    if (answer.kind === 'consent_off') {
      store.update((d) => void (d.settings.memoryOptIn = false));
      return { saved, remote: 'off' };
    }
    const reply = answer.kind === 'ok' ? FactsReply.safeParse(answer.data) : null;
    if (!reply?.success) return { saved, remote: 'failed' };
    const sent = new Set((s.persona.removed ?? []).map((r) => `${r.id}:${r.at}`));
    store.update((d) => {
      // Drop only the removals this request carried; one made while it was in flight stays for the next sync.
      const left = (d.persona.removed ?? []).filter((r) => !sent.has(`${r.id}:${r.at}`));
      if (left.length > 0) d.persona.removed = left;
      else delete d.persona.removed;
      d.persona.facts = mergeRemote(d, reply.data.facts);
    });
    return { saved: state().persona.facts.length, remote: 'ok' };
  }

  async function doEnable(): Promise<{ ok: boolean; remote: RemoteStatus }> {
    if (!ready()) return { ok: false, remote: 'failed' };
    if (!(await goOnline())) return { ok: false, remote: 'paused' };
    const answer = await post(CONSENT_PATH, { granted: true });
    if (answer.kind !== 'ok') return { ok: false, remote: 'failed' };
    store.update((d) => void (d.settings.memoryOptIn = true));
    return { ok: true, remote: (await doSync()).remote };
  }

  async function doDisable(): Promise<{ ok: boolean; remote: RemoteStatus }> {
    if (!ready()) return { ok: false, remote: 'failed' };
    if (!state().settings.memoryOptIn) return { ok: true, remote: 'off' };
    // Revoke on the server first: if that fails, memory is still on there, so it must not look off here.
    if (!online()) return { ok: false, remote: 'paused' };
    if ((await post(CONSENT_PATH, { granted: false })).kind !== 'ok') return { ok: false, remote: 'failed' };
    store.update((d) => void (d.settings.memoryOptIn = false));
    return { ok: true, remote: 'off' };
  }

  async function doForget(): Promise<{ remote: RemoteStatus }> {
    if (!ready()) return { remote: 'failed' };
    const s = state();
    let remote: RemoteStatus = 'off';
    if (online()) {
      // Also when memory is switched off: turning it off never deleted what was already saved.
      const answer = await post(FORGET_PATH, {});
      if (answer.kind !== 'ok' || ForgetReply.safeParse(answer.data).data?.status !== 'ok') return { remote: 'failed' };
      remote = 'ok';
    } else if (s.settings.memoryOptIn || s.persona.facts.length > 0 || (s.persona.removed?.length ?? 0) > 0) {
      // This device has saved facts before, so a copy may exist that cannot be erased from here right now.
      return { remote: 'paused' };
    }
    store.update((d) => {
      d.persona.facts = [];
      delete d.persona.removed;
      d.settings.memoryOptIn = false;
    });
    return { remote };
  }

  return {
    /** Called by the screen whenever sign-in changes, so a call made later sees the state at that moment. */
    setAuthStatus: (status: AuthStatus): void => void (pushed = status),
    syncPersona: () => inOrder(doSync),
    enableMemory: () => inOrder(doEnable),
    disableMemory: () => inOrder(doDisable),
    forgetAll: () => inOrder(doForget),
    /** "Delete everything": forget first, reset the device only if that worked. */
    deleteEverything: () =>
      inOrder(async (): Promise<{ status: 'ok' | 'failed' | 'paused' }> => {
        const { remote } = await doForget();
        if (remote === 'failed' || remote === 'paused') return { status: remote };
        return { status: store.reset().ok ? 'ok' : 'failed' };
      }),
  };
}

export type MemoryActions = ReturnType<typeof createMemoryActions>;
