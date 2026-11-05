import { handleForget } from '@/features/memory/server';
import { routeDeps } from '@/features/memory/serverDeps';

export const dynamic = 'force-dynamic';

export const POST = (req: Request): Promise<Response> => handleForget(req, routeDeps);
