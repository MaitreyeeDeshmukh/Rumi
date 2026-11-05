import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryActions, memoryCodeFor } from '@/features/memory/actions';
import { isRecoveryCode } from '@/features/memory/recoveryCode';
import type { PersonaFact, RumiState } from '@/features/shared/types';
import { defaultState } from '@/lib/storage';

const f = (key: string): PersonaFact => ({ id: `support_pref:${key}`, kind: 'support_pref', key, text: 'Please speak slowly.', createdAt: '' });
let produced: PersonaFact[] = [f('p1'), f('p5')];
const actions = createMemoryActions(() => produced);

// Applies updates to a local copy, like RumiProvider does.
let s: RumiState;
const update = (fn: (d: RumiState) => void) => { const d = structuredClone(s); fn(d); s = d; };

let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => (fetchMock.mock.calls as [string, RequestInit][]).map(([path, init]) => ({
  path, key: (init.headers as Record<string, string>)['x-rumi-key'], body: JSON.parse(init.body as string),
}));

beforeEach(() => {
  s = defaultState();
  produced = [f('p1'), f('p5')];
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('syncPersona', () => {
  it('memory off: stores facts locally and makes no fetch call', async () => {
    expect(await actions.syncPersona(s, update)).toEqual({ saved: 2, remote: 'off' });
    expect(s.persona.facts).toEqual(produced);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('memory on: posts the facts with the x-rumi-key header', async () => {
    await actions.enableMemory(s, update);
    fetchMock.mockClear();
    expect(await actions.syncPersona(s, update)).toEqual({ saved: 2, remote: 'ok' });
    expect(calls()).toEqual([{ path: '/api/memory/facts', key: s.persona.recoveryCode, body: { facts: produced } }]);
  });

  it('memory on: forgets facts the user turned off', async () => {
    await actions.enableMemory(s, update);
    fetchMock.mockClear();
    produced = [f('p1')];
    await actions.syncPersona(s, update);
    expect(calls()).toContainEqual({ path: '/api/memory/forget', key: s.persona.recoveryCode, body: { factIds: ['support_pref:p5'] } });
  });

  it('a failing fetch returns failed, never throws, and keeps the local facts', async () => {
    await actions.enableMemory(s, update);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await actions.syncPersona(s, update)).toEqual({ saved: 2, remote: 'failed' });
    expect(s.persona.facts).toEqual(produced);
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
    expect((await actions.syncPersona(s, update)).remote).toBe('failed');
  });

  it('a malformed stored code counts as memory off', async () => {
    s = { ...s, settings: { ...s.settings, memoryOptIn: true }, persona: { facts: [], recoveryCode: 'bad' } };
    expect((await actions.syncPersona(s, update)).remote).toBe('off');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('enableMemory / disableMemory', () => {
  it('creates a valid code once and keeps it on a second call', async () => {
    await actions.enableMemory(s, update);
    const code = s.persona.recoveryCode;
    expect(isRecoveryCode(code)).toBe(true);
    expect(s.settings.memoryOptIn).toBe(true);
    await actions.enableMemory(s, update);
    expect(s.persona.recoveryCode).toBe(code);
  });

  it('disable turns memory off but keeps the code so remote data can still be deleted', async () => {
    await actions.enableMemory(s, update);
    const code = s.persona.recoveryCode;
    await actions.disableMemory(update);
    expect(s.settings.memoryOptIn).toBe(false);
    expect(s.persona.recoveryCode).toBe(code);
    expect(memoryCodeFor(s)).toBeUndefined();
  });
});

describe('forgetAll', () => {
  it('posts every fact id, then empties facts, code and opt-in', async () => {
    await actions.enableMemory(s, update);
    const code = s.persona.recoveryCode;
    fetchMock.mockClear();
    expect(await actions.forgetAll(s, update)).toEqual({ remote: 'ok' });
    expect(calls()).toEqual([{ path: '/api/memory/forget', key: code, body: { factIds: ['support_pref:p1', 'support_pref:p5'] } }]);
    expect(s.persona).toEqual({ facts: [], recoveryCode: undefined });
    expect(s.settings.memoryOptIn).toBe(false);
  });

  it('still deletes remotely after memory was switched off', async () => {
    await actions.enableMemory(s, update);
    await actions.disableMemory(update);
    fetchMock.mockClear();
    expect(await actions.forgetAll(s, update)).toEqual({ remote: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('on a remote failure clears nothing, so the user can try again', async () => {
    await actions.enableMemory(s, update);
    const before = structuredClone(s);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await actions.forgetAll(s, update)).toEqual({ remote: 'failed' });
    expect(s).toEqual(before);
  });

  it('with no code it only clears locally', async () => {
    await actions.syncPersona(s, update);
    expect(await actions.forgetAll(s, update)).toEqual({ remote: 'off' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(s.persona.facts).toEqual([]);
  });
});

describe('memoryCodeFor', () => {
  it('returns the code only when memory is on', async () => {
    expect(memoryCodeFor(s)).toBeUndefined();
    await actions.enableMemory(s, update);
    expect(memoryCodeFor(s)).toBe(s.persona.recoveryCode);
  });
});
