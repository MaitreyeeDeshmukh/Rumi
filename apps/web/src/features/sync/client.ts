/**
 * Browser side of the sync routes (/api/sync/*): the `SyncRepository` and the `DocumentStore`, over an injected fetch.
 * Nothing here retries; the engine decides when to try again. Answers are sorted into the few outcomes the engine
 * understands (types.ts). The server's message text is never read, shown or logged.
 */
import { z } from 'zod';
import { DOC_LIMITS, type DocumentStore, type Result, type SyncFailure, type SyncRepository } from './types';
import { parseRemote } from './wire';

type FetchFn = typeof fetch;
const TIMEOUT_MS = 25_000;

const failed = (reason: SyncFailure): { ok: false; reason: SyncFailure } => ({ ok: false, reason });

/** One call. Never throws. Returns the parsed JSON body on 2xx, or the reason it failed. */
async function call(fetchFn: FetchFn, path: string, init: RequestInit): Promise<Result<unknown>> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(path, { credentials: 'same-origin', ...init, signal: ctl.signal });
    if (res.ok) return { ok: true, data: await res.json().catch(() => null) };
    const code = ((await res.json().catch(() => null)) as { error?: { code?: unknown } } | null)?.error?.code;
    if (res.status === 401) return failed('auth');
    if (res.status === 403 && code === 'consent_required') return failed('consent');
    if (res.status === 403 && code === 'account_required') return failed('account');
    if (res.status === 503 && code === 'sync_paused') return failed('paused');
    return failed('failed');
  } catch {
    return failed('failed'); // network down or timed out
  } finally {
    clearTimeout(timer);
  }
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const Granted = z.object({ granted: z.boolean() });
const Written = z.object({ written: z.number().int().nonnegative() });
const Link = z.object({ url: z.string().url(), expiresInSec: z.number().positive() });
const OkStatus = z.object({ status: z.literal('ok') });

function parsed<T>(res: Result<unknown>, schema: z.ZodType<T>): Result<T> {
  if (!res.ok) return res;
  const r = schema.safeParse(res.data);
  return r.success ? { ok: true, data: r.data } : failed('failed');
}

export function createHttpRepository(fetchFn: FetchFn): SyncRepository {
  return {
    async getConsent() {
      return parsed(await call(fetchFn, '/api/sync/consent', { method: 'GET' }), Granted);
    },
    async setConsent(granted) {
      return parsed(await call(fetchFn, '/api/sync/consent', json({ granted })), Granted);
    },
    async pull() {
      const res = await call(fetchFn, '/api/sync/data', { method: 'GET' });
      if (!res.ok) return res;
      const remote = parseRemote(res.data);
      return remote ? { ok: true, data: remote } : failed('failed');
    },
    async push(batch) {
      return parsed(await call(fetchFn, '/api/sync/data', json(batch)), Written);
    },
    async forget() {
      const res = parsed(await call(fetchFn, '/api/sync/forget', json({})), OkStatus);
      return res.ok ? { ok: true, data: null } : res;
    },
  };
}

const docQuery = (apptId: string, docId: string): string => `?${new URLSearchParams({ appt: apptId, doc: docId }).toString()}`;

export function createHttpDocumentStore(fetchFn: FetchFn): DocumentStore {
  const none = (res: Result<unknown>): Result<null> => (res.ok ? { ok: true, data: null } : res);
  return {
    async upload(apptId, docId, file) {
      // Checked here too so a person is not made to wait for an answer the server would refuse.
      if (file.size > DOC_LIMITS.maxBytes || !(DOC_LIMITS.types as readonly string[]).includes(file.type)) return failed('failed');
      return none(await call(fetchFn, `/api/sync/doc${docQuery(apptId, docId)}`, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file }));
    },
    async signedUrl(apptId, docId) {
      return parsed(await call(fetchFn, `/api/sync/doc${docQuery(apptId, docId)}`, { method: 'GET' }), Link);
    },
    async remove(apptId, docId) {
      return none(await call(fetchFn, `/api/sync/doc${docQuery(apptId, docId)}`, { method: 'DELETE' }));
    },
  };
}
