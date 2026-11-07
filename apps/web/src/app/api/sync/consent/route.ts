import { handleConsent } from '@/features/sync/server';
import { syncDeps } from '@/features/sync/serverDeps';

export const dynamic = 'force-dynamic';

export const GET = (req: Request): Promise<Response> => handleConsent(req, syncDeps);
export const POST = (req: Request): Promise<Response> => handleConsent(req, syncDeps);
