import { memoryHandlers } from '@/features/memory/memoryHandlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (req: Request): Promise<Response> => memoryHandlers.facts(req);
