/** The real dependencies of the memory routes. Server only: the browser never imports this file. */
import { readJson } from '@/lib/ai/http';
import { getFlag } from '@/lib/ai/flags';
import { requireUser } from '@/lib/auth/requireUser';
import { guardRequest } from '@/lib/security/guardRequest';
import { getServerClient } from '@/lib/supabase/server';
import type { RouteDeps } from './server';
import type { MemoryDb } from './types';

export const routeDeps: RouteDeps = {
  // guardRequest throws HttpError only: same origin, address rate limit, declared size. Its session cookie is not used here.
  guard: (req, maxBytes) => void guardRequest(req, { maxBytes }),
  requireUser,
  getDb: async (req) => (await getServerClient(req)) as unknown as MemoryDb,
  getFlag,
  readJson,
  now: Date.now,
};
