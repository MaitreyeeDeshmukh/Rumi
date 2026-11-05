/**
 * The three memory routes, as plain functions over injected dependencies (the route files wire the real ones).
 * Every route: same-origin and size checks (guard), then a verified user (requireUser), then the work.
 * Answers carry a code, one plain sentence and the request id. They never carry the database's message.
 *  - facts:   writes a batch (and any removals) as the signed-in user, answers with what is stored.
 *             Off when the `memory_sync_enabled` flag is off (cloud writes fail safe).
 *  - forget:  revokes consent FIRST (so no push can land after the erase), then erases, then proves consent is off and
 *             no row is left. Ignores the flag, so a person can always delete.
 *  - consent: turn persona memory on or off for this account. Also ignores the flag.
 * Consent is checked before any read or write on the facts route; off is 403 `consent_required`, which the browser
 * treats as "memory is off", not an error. A 42501 from anything but the write RPC is `permission_denied` (a missing
 * GRANT or a broken policy): a loud 500 with an ERROR log, never read as "consent is off".
 * Every route is limited per signed-in user as well as per address.
 */
import { z } from 'zod';
import { HttpError, json } from '@/lib/ai/http';
import { AppError, toResponse } from '@/lib/errors';
import { createLogger, type Logger } from '@/lib/log';
import { REQUEST_ID_HEADER, newRequestId } from '@/lib/requestContext';
import { parseFactBatch } from './sanitize';
import { createSupabaseStore } from './supabaseStore';
import { MemoryStoreError, type MemoryDb } from './types';

export const MAX_BODY_BYTES = 32_000;

export interface RouteDeps {
  /** Same origin, rate limit and declared size. Throws HttpError. */
  guard: (req: Request, maxBytes: number) => void;
  requireUser: (req: Request) => Promise<{ userId: string }>;
  /** A database client that acts as the signed-in user (cookie-bound, publishable key). */
  getDb: (req: Request) => Promise<MemoryDb>;
  getFlag: (key: 'memory_sync_enabled') => Promise<boolean>;
  readJson: (req: Request, maxBytes: number) => Promise<unknown>;
  /** Per-user limit, checked after sign-in. Throws HttpError 429. */
  userLimit: (userId: string) => void;
  now: () => number;
  /** Only a test sets this, to see what is logged. */
  createLog?: typeof createLogger;
}

type Code = 'bad_input' | 'too_large' | 'unauthorized' | 'forbidden' | 'consent_required' | 'rate_limited' | 'store_unavailable' | 'permission_denied';
const MESSAGE: Record<Code, string> = {
  bad_input: 'I could not read that. Check it and try again.',
  too_large: 'That is too long. Make it shorter and try again.',
  unauthorized: 'You are not signed in yet. Try again in a moment.',
  forbidden: 'This request was blocked. Reload the page and try again.',
  consent_required: 'Memory is off. Turn it on to save.',
  rate_limited: 'That was too many tries. Wait a minute and try again.',
  store_unavailable: 'Saving is paused. Your work is on this device.',
  permission_denied: 'Saving is paused. Your work is on this device.',
};

/** A request id from the browser is used only if it looks like one; anything else (log forging, huge values) is replaced. */
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

function fail(status: number, code: Code, requestId: string, headers: Record<string, string> = {}): Response {
  return json({ error: { code, message: MESSAGE[code], requestId } }, status, { [REQUEST_ID_HEADER]: requestId, ...headers });
}
const ok = (body: unknown, requestId: string): Response => json(body, 200, { [REQUEST_ID_HEADER]: requestId });

/** One place that turns any failure into an answer and decides what is logged. Caller faults are not ERROR. */
function answer(e: unknown, requestId: string, log: Logger): Response {
  if (e instanceof AppError) return toResponse(e, requestId);
  if (e instanceof HttpError) {
    if (e.code === 'ai_unavailable' || e.code === 'ai_invalid') {
      log.error('memory_guard_failed', e);
      return fail(503, 'store_unavailable', requestId);
    }
    return fail(e.status, e.code, requestId, e.status === 429 ? { 'Retry-After': String(Math.max(1, Math.ceil(e.retryAfterSec ?? 60))) } : {});
  }
  if (e instanceof MemoryStoreError) {
    if (e.reason === 'consent_required') {
      log.info('memory_consent_required');
      return fail(403, 'consent_required', requestId);
    }
    if (e.reason === 'unauthorized') {
      log.info('memory_unauthorized');
      return fail(401, 'unauthorized', requestId);
    }
    if (e.reason === 'permission_denied') {
      log.error('memory_permission_denied', e, { reason: e.reason, pgcode: '42501' });
      return fail(500, 'permission_denied', requestId);
    }
    // invalid here means the database refused a batch we had already checked: our bug, so it is an ERROR like the rest.
    log.error('memory_store_failed', e, { reason: e.reason });
    return fail(503, 'store_unavailable', requestId);
  }
  log.error('memory_route_failed', e);
  return fail(503, 'store_unavailable', requestId);
}

async function run(req: Request, route: string, work: (log: Logger, requestId: string, userId: string) => Promise<Response>, deps: RouteDeps): Promise<Response> {
  const sent = req.headers.get(REQUEST_ID_HEADER);
  const requestId = sent !== null && REQUEST_ID_RE.test(sent) ? sent : newRequestId();
  const log = (deps.createLog ?? createLogger)({ requestId, route });
  try {
    deps.guard(req, MAX_BODY_BYTES);
    const { userId } = await deps.requireUser(req);
    deps.userLimit(userId);
    return await work(log, requestId, userId);
  } catch (e) {
    return answer(e, requestId, log);
  }
}

export function handleFacts(req: Request, deps: RouteDeps): Promise<Response> {
  return run(
    req,
    '/api/memory/facts',
    async (log, requestId, userId) => {
      if (!(await deps.getFlag('memory_sync_enabled'))) {
        log.info('memory_sync_off');
        return fail(503, 'store_unavailable', requestId);
      }
      const batch = parseFactBatch(await deps.readJson(req, MAX_BODY_BYTES), deps.now());
      if (!batch.ok) return fail(batch.reason === 'too_many' ? 413 : 400, batch.reason === 'too_many' ? 'too_large' : 'bad_input', requestId);
      const store = createSupabaseStore(await deps.getDb(req), userId);
      // Before any read or write, even for an empty batch (an empty write would pass RLS and reveal what is stored).
      if (!(await store.hasConsent())) throw new MemoryStoreError('consent_required');
      await store.removeFacts(batch.removed);
      const saved = await store.upsertFacts(batch.facts);
      const { facts, rejected } = await store.search();
      // Consent can be withdrawn while this request runs: what was just read must not be handed back then.
      if (!(await store.hasConsent())) throw new MemoryStoreError('consent_required');
      if (batch.clamped > 0) log.warn('memory_stamps_clamped', { count: batch.clamped });
      log.info('memory_facts_ok', { saved, removed: batch.removed.length, stored: facts.length, rejected });
      return ok({ saved, rejected, facts }, requestId);
    },
    deps,
  );
}

export function handleForget(req: Request, deps: RouteDeps): Promise<Response> {
  return run(
    req,
    '/api/memory/forget',
    async (log, requestId, userId) => {
      const store = createSupabaseStore(await deps.getDb(req), userId);
      // Consent first: from here on the database refuses every push, so nothing can land after the erase.
      // If this fails nothing was erased and the answer is a failure.
      await store.setConsent(false);
      await store.forget(); // throws erasure_incomplete unless zero rows remain: answered as a failure, never as ok
      if (await store.hasConsent()) throw new MemoryStoreError('unavailable'); // the revoke did not stick
      log.info('memory_forget_ok');
      return ok({ status: 'ok' }, requestId);
    },
    deps,
  );
}

const ConsentRequest = z.strictObject({ granted: z.boolean() });

export function handleConsent(req: Request, deps: RouteDeps): Promise<Response> {
  return run(
    req,
    '/api/memory/consent',
    async (log, requestId, userId) => {
      const body = ConsentRequest.safeParse(await deps.readJson(req, MAX_BODY_BYTES));
      if (!body.success) return fail(400, 'bad_input', requestId);
      await createSupabaseStore(await deps.getDb(req), userId).setConsent(body.data.granted);
      log.info('memory_consent_set', { granted: body.data.granted });
      return ok({ granted: body.data.granted }, requestId);
    },
    deps,
  );
}
