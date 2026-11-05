import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { allStrings, createCallApi, INVALID, OFFLINE, TIMEOUT_MS } from '@/lib/api/client';

// Fake crisis check: the real one is Rudheer's src/lib/crisis.ts.
const callApi = createCallApi((t) => /hurt myself/i.test(t));
const Reply = z.object({ script: z.string() });
const body = { plan: { items: [{ text: 'I keep getting headaches' }] }, companionName: 'Rumi' };

const reply = (status: number, data: unknown) =>
  new Response(typeof data === 'string' ? data : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => reply(200, { script: 'Hello.' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const sentHeaders = () => (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;

describe('callApi', () => {
  it('returns the parsed reply on 200', async () => {
    expect(await callApi('/api/sayit', body, Reply)).toEqual({ ok: true, data: { script: 'Hello.' } });
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/sayit');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it('crisis text in a nested field returns crisis and never calls fetch', async () => {
    const bad = { plan: { items: [{ text: 'I want to hurt myself' }] } };
    expect(await callApi('/api/plan', bad, Reply)).toEqual({ ok: false, crisis: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offline returns ai_unavailable without calling fetch', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(await callApi('/api/plan', body, Reply)).toEqual({ ok: false, error: { code: 'ai_unavailable', message: OFFLINE } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('server crisis reply returns crisis', async () => {
    fetchMock.mockResolvedValue(reply(200, { crisis: true }));
    expect(await callApi('/api/plan', body, Reply)).toEqual({ ok: false, crisis: true });
  });

  it('429 with an error body keeps its code and message', async () => {
    fetchMock.mockResolvedValue(reply(429, { error: { code: 'rate_limited', message: 'Please wait a minute.' } }));
    expect(await callApi('/api/plan', body, Reply)).toEqual({ ok: false, error: { code: 'rate_limited', message: 'Please wait a minute.' } });
  });

  it('error body with an unknown code or no body falls back to ai_unavailable', async () => {
    fetchMock.mockResolvedValue(reply(500, { error: { code: 'boom', message: 42 } }));
    expect(await callApi('/api/plan', body, Reply)).toEqual({ ok: false, error: { code: 'ai_unavailable', message: OFFLINE } });
    fetchMock.mockResolvedValue(reply(502, '<html>bad gateway</html>'));
    expect(await callApi('/api/plan', body, Reply)).toEqual({ ok: false, error: { code: 'ai_unavailable', message: OFFLINE } });
  });

  it('200 with a body that fails the schema returns ai_invalid', async () => {
    fetchMock.mockResolvedValue(reply(200, { script: 7 }));
    expect(await callApi('/api/plan', body, Reply)).toEqual({ ok: false, error: { code: 'ai_invalid', message: INVALID } });
  });

  it('fetch rejecting returns ai_unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await callApi('/api/plan', body, Reply)).toEqual({ ok: false, error: { code: 'ai_unavailable', message: OFFLINE } });
  });

  it('a request slower than the timeout is aborted and returns ai_unavailable', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_p: string, init: RequestInit) => new Promise((_, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    const pending = callApi('/api/plan', body, Reply);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, error: { code: 'ai_unavailable', message: OFFLINE } });
  });

  it('sends x-rumi-key only when a memoryCode is given', async () => {
    await callApi('/api/plan', body, Reply, { memoryCode: 'ABCDE-FGHJK-LMNPQ-RSTUV' });
    expect(sentHeaders()['x-rumi-key']).toBe('ABCDE-FGHJK-LMNPQ-RSTUV');
    fetchMock.mockClear();
    await callApi('/api/plan', body, Reply);
    expect(sentHeaders()).not.toHaveProperty('x-rumi-key');
    fetchMock.mockClear();
    await callApi('/api/plan', body, Reply, { memoryCode: undefined });
    expect(sentHeaders()).not.toHaveProperty('x-rumi-key');
  });
});

describe('allStrings', () => {
  it('collects strings from nested objects and arrays, skipping other types', () => {
    expect(allStrings({ a: 'x', b: [1, 'y', { c: 'z', d: null }], e: true })).toEqual(['x', 'y', 'z']);
  });
});
