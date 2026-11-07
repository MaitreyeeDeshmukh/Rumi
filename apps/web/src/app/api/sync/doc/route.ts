import { handleDoc } from '@/features/sync/server';
import { syncDeps } from '@/features/sync/serverDeps';

export const dynamic = 'force-dynamic';

export const GET = (req: Request): Promise<Response> => handleDoc(req, syncDeps);
export const PUT = (req: Request): Promise<Response> => handleDoc(req, syncDeps);
export const DELETE = (req: Request): Promise<Response> => handleDoc(req, syncDeps);
