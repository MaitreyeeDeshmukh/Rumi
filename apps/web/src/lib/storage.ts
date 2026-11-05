import type { RumiState, Settings } from '@/features/shared/types';

export const KEY = 'rumi.v1';

export const defaultSettings = (): Settings => ({
  name: '', companionName: 'Rumi', theme: 'soft', textScale: 1, reducedMotion: false,
  outputMode: 'both', detail: 'short', speechRate: 1, finishSound: false, memoryOptIn: false,
});

export const defaultState = (): RumiState => ({ version: 1, settings: defaultSettings(), sessions: [], persona: { facts: [] } });

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** window.localStorage, or null on the server or when the browser blocks storage (accessing it can throw). */
const local = (): Store | null => {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
};

export function loadState(store: Pick<Storage, 'getItem'> | null = local()): RumiState {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return defaultState();
    const p = JSON.parse(raw) as Partial<RumiState> | null;
    if (!p || typeof p !== 'object' || p.version !== 1) return defaultState();
    const d = defaultState();
    return {
      ...d, ...p,
      settings: { ...d.settings, ...p.settings },
      // old saved data has no focus or helpLevelUsed: give it safe defaults instead of crashing
      sessions: Array.isArray(p.sessions)
        ? p.sessions.map((s) => ({ ...s, focus: s.focus ?? 'whole', helpLevelUsed: s.helpLevelUsed ?? {} }))
        : [],
      plan: p.plan && Array.isArray(p.plan.items) ? p.plan : undefined,
      persona: { facts: Array.isArray(p.persona?.facts) ? p.persona.facts : [], recoveryCode: p.persona?.recoveryCode },
    };
  } catch {
    return defaultState(); // corrupt JSON or blocked storage: start clean, never white-screen
  }
}

export function saveState(s: RumiState): void {
  try { local()?.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked: the app still works in memory */ }
}

export function resetState(): void {
  try { local()?.removeItem(KEY); } catch { /* nothing to do */ }
}
