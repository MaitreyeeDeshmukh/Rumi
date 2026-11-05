import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, defaultState, KEY, loadState, resetState, saveState } from '@/lib/storage';

const from = (raw: string | null) => ({ getItem: () => raw });

afterEach(() => vi.unstubAllGlobals());

describe('loadState', () => {
  it('returns defaults for corrupt JSON', () => {
    expect(loadState(from('{not json'))).toEqual(defaultState());
  });

  it('returns defaults for an unknown version', () => {
    expect(loadState(from(JSON.stringify({ version: 2 })))).toEqual(defaultState());
  });

  it('returns defaults for null storage, empty storage and JSON null', () => {
    expect(loadState(null)).toEqual(defaultState());
    expect(loadState(from(null))).toEqual(defaultState());
    expect(loadState(from('null'))).toEqual(defaultState());
  });

  it('returns defaults when getItem throws', () => {
    expect(loadState({ getItem: () => { throw new Error('blocked'); } })).toEqual(defaultState());
  });

  it('gives old sessions a focus and helpLevelUsed', () => {
    const old = { version: 1, sessions: [{ id: 's1', planId: 'p', startedAt: '', turns: [], coveredItemIds: [], helpCount: 0 }] };
    const s = loadState(from(JSON.stringify(old)));
    expect(s.sessions[0].focus).toBe('whole');
    expect(s.sessions[0].helpLevelUsed).toEqual({});
  });

  it('drops a plan whose items are not an array', () => {
    expect(loadState(from(JSON.stringify({ version: 1, plan: { items: 'x' } }))).plan).toBeUndefined();
  });

  it('fills missing settings and persona from defaults', () => {
    const s = loadState(from(JSON.stringify({ version: 1, settings: { name: 'Sam' }, persona: { facts: 'bad' } })));
    expect(s.settings).toEqual({ ...defaultSettings(), name: 'Sam' });
    expect(s.persona.facts).toEqual([]);
  });

  it('round-trips what saveState wrote', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) } });
    const s = { ...defaultState(), settings: { ...defaultSettings(), memoryOptIn: true } };
    saveState(s);
    expect(loadState()).toEqual(s);
    resetState();
    expect(data.has(KEY)).toBe(false);
  });
});

describe('saveState / resetState', () => {
  it('does not throw when setItem throws (storage full)', () => {
    vi.stubGlobal('window', { localStorage: { setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => { throw new Error('blocked'); } } });
    expect(() => saveState(defaultState())).not.toThrow();
    expect(() => resetState()).not.toThrow();
  });

  it('does not throw when reading localStorage itself throws', () => {
    vi.stubGlobal('window', Object.defineProperty({}, 'localStorage', { get: () => { throw new Error('SecurityError'); } }));
    expect(() => saveState(defaultState())).not.toThrow();
    expect(loadState()).toEqual(defaultState());
  });

  it('does nothing on the server (no window)', () => {
    expect(() => saveState(defaultState())).not.toThrow();
    expect(loadState()).toEqual(defaultState());
  });
});
