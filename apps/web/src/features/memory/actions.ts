// Client side. The only code in the browser that talks to /api/memory/*, and only when memory is on.
import type { PersonaFact, RumiState } from '@/features/shared/types';
import type { RumiCtx } from '@/features/state/RumiProvider';
import { isRecoveryCode, newRecoveryCode } from './recoveryCode';

export type Remote = 'off' | 'ok' | 'failed';
type Update = RumiCtx['update'];

export const MEMORY_FETCH_TIMEOUT_MS = 10_000;

/** The code to send as x-rumi-key on AI calls, or undefined when memory is off. */
export const memoryCodeFor = (s: RumiState): string | undefined =>
  s.settings.memoryOptIn && isRecoveryCode(s.persona.recoveryCode) ? s.persona.recoveryCode : undefined;

/** POST to a memory route. Never throws: false on any failure. Nothing is logged. */
async function post(path: '/api/memory/facts' | '/api/memory/forget', code: string, body: unknown): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), MEMORY_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method: 'POST', credentials: 'same-origin', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'x-rumi-key': code },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function createMemoryActions(factsFromState: (s: RumiState) => PersonaFact[]) {
  /**
   * 1) Always: recompute facts from what the user chose and did, and store them locally.
   * 2) Only when memory is on: save them remotely, and forget facts the user turned off.
   * A remote failure returns 'failed' and never throws; the local copy is already saved.
   */
  async function syncPersona(state: RumiState, update: Update): Promise<{ saved: number; remote: Remote }> {
    const facts = factsFromState(state);
    update((d) => { d.persona.facts = facts; });
    const code = memoryCodeFor(state);
    if (!code) return { saved: facts.length, remote: 'off' };

    const now = new Set(facts.map((f) => f.id));
    const removed = state.persona.facts.map((f) => f.id).filter((id) => !now.has(id));
    const [saved, forgot] = await Promise.all([
      facts.length ? post('/api/memory/facts', code, { facts }) : Promise.resolve(true),
      removed.length ? post('/api/memory/forget', code, { factIds: removed }) : Promise.resolve(true),
    ]);
    return { saved: facts.length, remote: saved && forgot ? 'ok' : 'failed' };
  }

  /** Creates the recovery code once (kept on later calls), turns memory on, then syncs. */
  async function enableMemory(state: RumiState, update: Update): Promise<{ remote: Remote }> {
    const recoveryCode = isRecoveryCode(state.persona.recoveryCode) ? state.persona.recoveryCode : newRecoveryCode();
    update((d) => { d.settings.memoryOptIn = true; d.persona.recoveryCode = recoveryCode; });
    const next: RumiState = { ...state, settings: { ...state.settings, memoryOptIn: true }, persona: { ...state.persona, recoveryCode } };
    const { remote } = await syncPersona(next, update);
    return { remote };
  }

  /** Stops sending anything. Remote data stays until forgetAll, and the code is kept so it can be deleted later. */
  async function disableMemory(update: Update): Promise<void> {
    update((d) => { d.settings.memoryOptIn = false; });
  }

  /**
   * Asks the server to forget every local fact, then clears facts, code and opt-in.
   * Works even if memory was switched off earlier (remote data is still there).
   * If the remote call fails, nothing is cleared, so the user still holds the code and can try again.
   */
  async function forgetAll(state: RumiState, update: Update): Promise<{ remote: Remote }> {
    const code = isRecoveryCode(state.persona.recoveryCode) ? state.persona.recoveryCode : undefined;
    const ids = state.persona.facts.map((f) => f.id);
    let remote: Remote = 'off';
    if (code) {
      remote = !ids.length || (await post('/api/memory/forget', code, { factIds: ids })) ? 'ok' : 'failed';
      if (remote === 'failed') return { remote };
    }
    update((d) => { d.persona.facts = []; d.persona.recoveryCode = undefined; d.settings.memoryOptIn = false; });
    return { remote };
  }

  return { syncPersona, enableMemory, disableMemory, forgetAll };
}

export type MemoryActions = ReturnType<typeof createMemoryActions>;
