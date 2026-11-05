import { memoryHandlers } from '@/features/memory/memoryHandlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** An erase waits for indexing to settle and checks the list again: about 8 seconds, up to 20 (I-059). */
export const maxDuration = 30;

export const POST = (req: Request): Promise<Response> => memoryHandlers.forget(req);
