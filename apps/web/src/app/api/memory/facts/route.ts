import { memoryHandlers } from '@/features/memory/memoryHandlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A sync upserts one fact at a time, lists, and deletes stale ones: well over the default on a slow day. */
export const maxDuration = 30;

export const POST = (req: Request): Promise<Response> => memoryHandlers.facts(req);
