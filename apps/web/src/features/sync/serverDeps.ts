/** The real dependencies of the sync routes. Server only: the browser never imports this file. */
import { makeUserLimit, newUserLimiter } from '@/features/memory/serverDeps';
import { getFlag } from '@/lib/ai/flags';
import { readJson } from '@/lib/ai/http';
import { guardRequest } from '@/lib/security/guardRequest';
import { getServerClient } from '@/lib/supabase/server';
import type { SyncDeps } from './server';

export const syncDeps: SyncDeps = {
  // guardRequest is async and throws AppError only; it must be awaited.
  guard: async (req, maxBytes) => {
    const { user } = await guardRequest(req, { maxBytes, requireAuth: true });
    return { userId: user.userId, isAnonymous: user.isAnonymous };
  },
  getClient: (req) => getServerClient(req),
  getFlag,
  readJson,
  userLimit: makeUserLimit(newUserLimiter()),
  now: Date.now,
};
