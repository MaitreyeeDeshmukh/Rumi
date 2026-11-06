/** The real recall for a request: consent is read from Supabase as the signed-in person, then Supermemory is asked. Server only. */
import { memoryEnabled } from '@/lib/env';
import { createSupabaseStore } from './supabaseStore';
import { recallForTask } from './supermemory';
import type { MemoryDb } from './types';

export interface RecallArgs {
  req: Request;
  userId: string;
  task: string;
  queryText: string;
}

/** Never throws. [] when memory is off, the person has not consented, or anything goes wrong. */
export async function recallForRequest(a: RecallArgs): Promise<string[]> {
  if (!memoryEnabled()) return [];
  try {
    const { getServerClient } = await import('@/lib/supabase/server');
    return await recallForTask({
      userId: a.userId,
      task: a.task,
      queryText: a.queryText,
      hasConsent: async () => createSupabaseStore((await getServerClient(a.req)) as unknown as MemoryDb, a.userId).hasConsent(),
    });
  } catch {
    return [];
  }
}
