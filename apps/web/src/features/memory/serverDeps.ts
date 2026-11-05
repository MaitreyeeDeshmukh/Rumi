/** The real dependencies of the memory routes. Server only: the browser never imports this file. */
import { createHash } from 'node:crypto';
import { HttpError, readJson } from '@/lib/ai/http';
import { getFlag } from '@/lib/ai/flags';
import { guardRequest } from '@/lib/security/guardRequest';
import { createRateLimiter, type RateLimiter } from '@/lib/security/rateLimit';
import { getServerClient } from '@/lib/supabase/server';
import type { RouteDeps } from './server';
import type { MemoryDb } from './types';

/**
 * A per-user limit on top of the per-address one (a shared Wi-Fi address and a script with many addresses are both
 * covered). Keyed by a hash of the user id, so the id itself is never held as a key. The limiter's own "address" slot
 * carries the user key; its instance cap is lifted because it would count every user together.
 */
export function makeUserLimit(limiter: RateLimiter): (userId: string) => void {
  return (userId) => {
    const key = `u:${createHash('sha256').update(userId).digest('hex').slice(0, 16)}`;
    const verdict = limiter.check(key, null);
    if (!verdict.ok) throw new HttpError(429, 'rate_limited', verdict.retryAfterSec);
  };
}
export const newUserLimiter = (): RateLimiter => createRateLimiter({ limits: { perIp: 20, perInstance: Number.MAX_SAFE_INTEGER } });

export const routeDeps: RouteDeps = {
  // guardRequest is async (it verifies the caller with Supabase Auth) and throws AppError only. It must be awaited: a dropped promise would let a refused request through.
  guard: async (req, maxBytes) => {
    const { user } = await guardRequest(req, { maxBytes, requireAuth: true });
    return { userId: user.userId };
  },
  getDb: async (req) => (await getServerClient(req)) as unknown as MemoryDb,
  getFlag,
  readJson,
  userLimit: makeUserLimit(newUserLimiter()),
  now: Date.now,
};
