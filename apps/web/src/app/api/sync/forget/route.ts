import { handleForget } from '@/features/sync/server';
import { syncDeps } from '@/features/sync/serverDeps';

export const dynamic = 'force-dynamic';

export const POST = (req: Request): Promise<Response> => handleForget(req, syncDeps);
