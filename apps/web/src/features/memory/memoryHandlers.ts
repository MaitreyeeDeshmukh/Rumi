/**
 * The two memory routes (server side; the browser never imports this, a test proves it).
 * Both run the same steps, in this order, and every failure is a fixed error body:
 *  1. the feature flag (off: a fixed `forbidden`, before anything else is touched, so nothing is reachable);
 *  2. `guardRequest` (same origin, session, rate limits, declared size, format of x-rumi-key);
 *  3. the key must be present, the body is read with a byte cap and must match a strict schema (unknown fields fail);
 *  4. the namespace is the HMAC of the code (Supermemory never sees the code).
 * No key, namespace, fact or error text is ever logged. One namespace queue is shared by both routes, so an
 * erase waits for a running sync (I-058).
 */
import { FactsRequest, ForgetRequest } from '@/features/shared/schemas';
import { HttpError, errorResponse, json, readJson } from '@/lib/ai/http';
import { getMemoryConfig, memoryEnabled, type MemoryConfig } from '@/lib/env';
import { guardRequest } from '@/lib/security/guardRequest';
import type { RateLimiter } from '@/lib/security/rateLimit';
import type { z } from 'zod';
import { forgetNamespace, type ForgetDeps } from './forgetAll';
import { createNamespaceQueue, createRemoteSync } from './remoteSync';
import { createSmClient, type SmClient } from './smClient';
import { tagFromCode } from './tag';

/** 20 facts of about 60 bytes each, or one number: far below the general body cap. */
const MEMORY_BODY_MAX = 4_000;

export interface MemoryHandlerDeps {
  enabled: () => boolean;
  /** Throws when a key or secret is missing; the route turns that into a fixed 503. */
  config: () => MemoryConfig;
  fetchFn: typeof fetch;
  limiter?: RateLimiter;
  /** Timing knobs for the erase (tests pass a fake clock). Production uses the defaults until the Phase 4 spike. */
  forget?: Pick<ForgetDeps, 'sleep' | 'now' | 'maxMs' | 'settleMs' | 'lagMs' | 'emptyStreak' | 'intervalMs'>;
}

export function createMemoryHandlers(deps: MemoryHandlerDeps) {
  const queue = createNamespaceQueue();

  async function handle<S extends z.ZodType>(req: Request, schema: S, job: (ns: string, client: SmClient, body: z.infer<S>) => Promise<unknown>): Promise<Response> {
    try {
      if (!deps.enabled()) throw new HttpError(404, 'forbidden');
      const guarded = guardRequest(req, { maxBytes: MEMORY_BODY_MAX, ...(deps.limiter ? { limiter: deps.limiter } : {}) });
      if (guarded.memoryKey === null) throw new HttpError(400, 'bad_input');
      const body = schema.safeParse(await readJson(req, MEMORY_BODY_MAX));
      if (!body.success) throw new HttpError(400, 'bad_input');

      let config: MemoryConfig;
      try {
        config = deps.config();
      } catch {
        throw new HttpError(503, 'ai_unavailable');
      }
      const ns = tagFromCode(guarded.memoryKey, config.tagSecret);
      const answer = json(await job(ns, createSmClient({ fetchFn: deps.fetchFn, apiKey: config.apiKey }), body.data));
      if (guarded.session.setCookie) answer.headers.append('Set-Cookie', guarded.session.setCookie);
      return answer;
    } catch (e) {
      // Anything that is not already a fixed HttpError (a Supermemory failure, a bad config) becomes one generic answer.
      return errorResponse(e instanceof HttpError ? e : new HttpError(503, 'ai_unavailable'));
    }
  }

  return {
    facts: (req: Request): Promise<Response> =>
      handle(req, FactsRequest, async (ns, client, body) => {
        const result = await createRemoteSync(client, queue).syncFacts(ns, body.facts);
        return { saved: result.saved, rejected: result.rejected };
      }),
    forget: (req: Request): Promise<Response> =>
      handle(req, ForgetRequest, async (ns, client, body) => ({
        status: await forgetNamespace(ns, { client, queue, ...deps.forget, ...(body.sinceSyncMs === undefined ? {} : { sinceSyncMs: body.sinceSyncMs }) }),
      })),
  };
}

/** The instance both route files use. Nothing is read from the environment until a request arrives. */
export const memoryHandlers = createMemoryHandlers({
  enabled: memoryEnabled,
  config: getMemoryConfig,
  fetchFn: (input, init) => fetch(input, init),
});
