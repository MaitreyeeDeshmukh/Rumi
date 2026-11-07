/**
 * The sync routes as plain functions over injected dependencies (the route files wire the real ones).
 *   consent  GET reads / POST sets the account's cloud_sync consent. Turning on needs the kill switch on; turning off never does.
 *   data     GET pulls everything the account stored; POST pushes a batch (checked again here, then sync_push).
 *   doc      PUT / GET (one-minute signed link) / DELETE the original file of one document.
 *   forget   takes consent back FIRST, then erases rows and files and proves it by counting. Ignores the kill switch.
 * Every route: same origin, size cap, address limit, a verified EMAIL account (a guest gets 403 account_required), a per-user
 * limit. Reads and writes of content also need consent (403 consent_required). Answers carry a code and a fixed sentence,
 * never the database's message and never a person's text. Logs hold counts only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ID_RE } from '@/features/shared/constants';
import { HttpError, json } from '@/lib/ai/http';
import { AppError, fingerprintOf, toResponse } from '@/lib/errors';
import { createLogger, type Logger } from '@/lib/log';
import { REQUEST_ID_HEADER, requestIdOf } from '@/lib/requestContext';
import { recordAppEvent } from '@/lib/telemetry/sinks';
import { DOC_BUCKET, docPath, matchesType, removeAllFiles, removeFolder } from './files';
import { SYNC_MESSAGE as MESSAGE } from '@/content/sync';
import { DOC_LIMITS } from './types';
import { PushBatch, SYNC_LIMITS, cleanBody, cleanChat, type PushBatchT } from './wire';

export const SYNC_POLICY_VERSION = 'sync-2026-11';

export interface SyncDeps {
  /** Same origin, size, address limit and the verified caller. Throws AppError or HttpError. */
  guard: (req: Request, maxBytes: number) => Promise<{ userId: string; isAnonymous: boolean }>;
  /** A client that acts as the signed-in person (cookie-bound, publishable key): RLS and Storage policies apply. */
  getClient: (req: Request) => Promise<SupabaseClient>;
  getFlag: (key: 'cloud_sync_enabled') => Promise<boolean>;
  readJson: (req: Request, maxBytes: number) => Promise<unknown>;
  userLimit: (userId: string) => void;
  now: () => number;
  createLog?: typeof createLogger;
}

type Code = 'bad_input' | 'too_large' | 'unauthorized' | 'forbidden' | 'account_required' | 'consent_required' | 'rate_limited' | 'store_unavailable' | 'sync_paused' | 'not_found';
const PAUSED_RETRY_SEC = 300;

class Refusal extends Error {
  constructor(readonly status: number, readonly code: Code, readonly headers: Record<string, string> = {}) {
    super(code);
  }
}

const fail = (status: number, code: Code, requestId: string, headers: Record<string, string> = {}): Response =>
  json({ error: { code, message: MESSAGE[code], requestId } }, status, { [REQUEST_ID_HEADER]: requestId, ...headers });
const ok = (body: unknown, requestId: string): Response => json(body, 200, { [REQUEST_ID_HEADER]: requestId });

interface Ctx {
  userId: string;
  client: SupabaseClient;
  log: Logger;
  requestId: string;
}
interface Opts {
  route: string;
  maxBytes: number;
  /** The kill switch must be on for this call. */
  flag: boolean;
}

/** What a database error means for the caller. 42501 is an RLS refusal, which here means consent is off. */
function dbRefusal(e: { code?: string; status?: number } | null): Refusal {
  if (e?.code === '42501') return new Refusal(403, 'consent_required');
  if (e?.status === 401 || e?.code === '28000' || e?.code === 'PGRST301') return new Refusal(401, 'unauthorized');
  if (/^(22|23|54)/.test(e?.code ?? '')) return new Refusal(400, 'bad_input');
  return new Refusal(503, 'store_unavailable');
}

async function hasConsent(client: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await client.from('core_consents').select('granted').eq('owner_id', userId).eq('kind', 'cloud_sync').limit(1);
  if (error) throw dbRefusal(error);
  return data?.[0]?.granted === true;
}
const requireConsent = async (c: Ctx): Promise<void> => {
  if (!(await hasConsent(c.client, c.userId))) throw new Refusal(403, 'consent_required');
};

async function setConsent(c: Ctx, granted: boolean, nowMs: number): Promise<void> {
  const at = new Date(nowMs).toISOString();
  const { error } = await c.client
    .from('core_consents')
    .upsert({ owner_id: c.userId, kind: 'cloud_sync', granted, policy_version: SYNC_POLICY_VERSION, granted_at: granted ? at : null, updated_at: at }, { onConflict: 'owner_id,kind' });
  if (error) throw dbRefusal(error);
}

async function run(req: Request, deps: SyncDeps, o: Opts, work: (c: Ctx) => Promise<Response>): Promise<Response> {
  const requestId = requestIdOf(req);
  const log = (deps.createLog ?? createLogger)({ requestId, route: o.route });
  let phase: 'auth' | 'work' = 'auth';
  try {
    const { userId, isAnonymous } = await deps.guard(req, o.maxBytes);
    if (isAnonymous) throw new Refusal(403, 'account_required');
    deps.userLimit(userId);
    phase = 'work';
    if (o.flag && !(await deps.getFlag('cloud_sync_enabled'))) {
      log.info('sync_off');
      throw new Refusal(503, 'sync_paused', { 'Retry-After': String(PAUSED_RETRY_SEC) });
    }
    return await work({ userId, client: await deps.getClient(req), log, requestId });
  } catch (e) {
    if (e instanceof Refusal) {
      // A kill switch or a refusal of the caller is normal. Only an unreachable store is a fault.
      if (e.status >= 500 && e.code === 'store_unavailable') {
        log.error('sync_store_failed', e);
        recordAppEvent({ source: 'server', area: 'sync', code: 'sync_store_failed', fingerprint: fingerprintOf(e), route: o.route, status: e.status });
      }
      return fail(e.status, e.code, requestId, e.headers);
    }
    if (e instanceof AppError) {
      if (e.code === 'unauthorized') return fail(401, 'unauthorized', requestId);
      return toResponse(e, requestId);
    }
    if (e instanceof HttpError) {
      if (e.code === 'rate_limited') return fail(429, 'rate_limited', requestId, { 'Retry-After': String(Math.max(1, Math.ceil(e.retryAfterSec ?? 60))) });
      return fail(e.status, e.code === 'too_large' ? 'too_large' : 'bad_input', requestId);
    }
    log.error('sync_route_failed', e);
    if (phase === 'work') recordAppEvent({ source: 'server', area: 'sync', code: 'sync_route_failed', fingerprint: fingerprintOf(e), route: o.route, status: 503 });
    return fail(503, 'store_unavailable', requestId);
  }
}

// ----------------------------------------------------------------------------------------------- consent
const ConsentBody = z.strictObject({ granted: z.boolean() });

export function handleConsent(req: Request, deps: SyncDeps): Promise<Response> {
  const route = '/api/sync/consent';
  if (req.method === 'GET') {
    return run(req, deps, { route, maxBytes: 1000, flag: true }, async (c) => ok({ granted: await hasConsent(c.client, c.userId) }, c.requestId));
  }
  return run(req, deps, { route, maxBytes: 1000, flag: false }, async (c) => {
    const body = ConsentBody.safeParse(await deps.readJson(req, 1000));
    if (!body.success) throw new Refusal(400, 'bad_input');
    // Turning on needs the kill switch on; turning off always works.
    if (body.data.granted && !(await deps.getFlag('cloud_sync_enabled'))) throw new Refusal(503, 'sync_paused', { 'Retry-After': String(PAUSED_RETRY_SEC) });
    await setConsent(c, body.data.granted, deps.now());
    c.log.info('sync_consent_set', { granted: body.data.granted });
    return ok({ granted: body.data.granted }, c.requestId);
  });
}

// ----------------------------------------------------------------------------------------------- data
/** Rebuilds the batch from what the app's own reader keeps, so no unknown field or oversize text is stored. */
function cleanBatch(batch: PushBatchT): PushBatchT {
  const appointments = batch.appointments.map((a) => {
    if (a.deleted) return { ...a, body: {} };
    const body = cleanBody(a.id, a.body);
    if (!body) throw new Refusal(400, 'bad_input');
    return { ...a, body: body as unknown as Record<string, unknown> };
  });
  const chats = batch.chats.map((c) => {
    if (c.deleted) return { ...c, messages: [] };
    const t = cleanChat(c);
    if (!t) throw new Refusal(400, 'bad_input');
    return { ...c, messages: t.messages };
  });
  return { appointments, documents: batch.documents, chats };
}

export function handleData(req: Request, deps: SyncDeps): Promise<Response> {
  const route = '/api/sync/data';
  if (req.method === 'GET') {
    return run(req, deps, { route, maxBytes: 1000, flag: true }, async (c) => {
      await requireConsent(c);
      const { data, error } = await c.client.rpc('sync_pull');
      if (error) throw dbRefusal(error);
      c.log.info('sync_pull_ok');
      return ok(data, c.requestId);
    });
  }
  return run(req, deps, { route, maxBytes: SYNC_LIMITS.requestBytes, flag: true }, async (c) => {
    const parsed = PushBatch.safeParse(await deps.readJson(req, SYNC_LIMITS.requestBytes));
    if (!parsed.success) throw new Refusal(400, 'bad_input');
    await requireConsent(c);
    const batch = cleanBatch(parsed.data);
    const { data, error } = await c.client.rpc('sync_push', { p_changes: batch });
    if (error) throw dbRefusal(error);
    // Files of what was deleted go too. Failing here fails the push, so the delete is sent again and the files follow.
    try {
      for (const a of batch.appointments) if (a.deleted) await removeFolder(c.client, `${c.userId}/${a.id}`);
      const gone = batch.documents.filter((d) => d.deleted && !batch.appointments.some((a) => a.deleted && a.id === d.appt_id));
      if (gone.length > 0) {
        const removed = await c.client.storage.from(DOC_BUCKET).remove(gone.map((d) => docPath(c.userId, d.appt_id, d.id)));
        if (removed.error) throw new Error('storage_remove');
      }
    } catch (e) {
      throw e instanceof Refusal ? e : new Refusal(503, 'store_unavailable');
    }
    c.log.info('sync_push_ok', { appointments: batch.appointments.length, documents: batch.documents.length, chats: batch.chats.length });
    return ok({ written: typeof data === 'number' ? data : 0 }, c.requestId);
  });
}

// ----------------------------------------------------------------------------------------------- forget
export function handleForget(req: Request, deps: SyncDeps): Promise<Response> {
  return run(req, deps, { route: '/api/sync/forget', maxBytes: 1000, flag: false }, async (c) => {
    await setConsent(c, false, deps.now()); // first: from here on the database refuses every write
    const { data, error } = await c.client.rpc('sync_forget_all');
    if (error) throw dbRefusal(error);
    if (data !== 0) throw new Refusal(503, 'store_unavailable');
    try {
      await removeAllFiles(c.client, c.userId);
    } catch {
      throw new Refusal(503, 'store_unavailable');
    }
    if (await hasConsent(c.client, c.userId)) throw new Refusal(503, 'store_unavailable'); // the revoke did not stick
    c.log.info('sync_forget_ok');
    return ok({ status: 'ok' }, c.requestId);
  });
}

// ----------------------------------------------------------------------------------------------- doc
export function handleDoc(req: Request, deps: SyncDeps): Promise<Response> {
  const route = '/api/sync/doc';
  const q = new URL(req.url).searchParams;
  const appt = q.get('appt') ?? '';
  const doc = q.get('doc') ?? '';
  const put = req.method === 'PUT';
  return run(req, deps, { route, maxBytes: put ? DOC_LIMITS.maxBytes : 1000, flag: req.method !== 'DELETE' }, async (c) => {
    if (!ID_RE.test(appt) || !ID_RE.test(doc)) throw new Refusal(400, 'bad_input');
    const bucket = c.client.storage.from(DOC_BUCKET);
    const path = docPath(c.userId, appt, doc);
    if (put) {
      const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!(DOC_LIMITS.types as readonly string[]).includes(type)) throw new Refusal(400, 'bad_input');
      await requireConsent(c);
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.byteLength === 0) throw new Refusal(400, 'bad_input');
      if (bytes.byteLength > DOC_LIMITS.maxBytes) throw new Refusal(413, 'too_large');
      if (!matchesType(type, bytes)) throw new Refusal(400, 'bad_input');
      const { error } = await bucket.upload(path, bytes, { contentType: type, upsert: true });
      if (error) throw new Refusal(503, 'store_unavailable');
      c.log.info('sync_doc_stored');
      return ok({ status: 'ok' }, c.requestId);
    }
    if (req.method === 'GET') {
      const { data, error } = await bucket.createSignedUrl(path, DOC_LIMITS.urlSeconds);
      if (error || !data?.signedUrl) throw new Refusal(404, 'not_found');
      return ok({ url: data.signedUrl, expiresInSec: DOC_LIMITS.urlSeconds }, c.requestId);
    }
    if (req.method === 'DELETE') {
      const { error } = await bucket.remove([path]);
      if (error) throw new Refusal(503, 'store_unavailable');
      return ok({ status: 'ok' }, c.requestId);
    }
    throw new Refusal(400, 'bad_input');
  });
}
