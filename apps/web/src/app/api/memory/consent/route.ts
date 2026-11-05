import { handleConsent } from '@/features/memory/server';
import { routeDeps } from '@/features/memory/serverDeps';

export const dynamic = 'force-dynamic';

export const POST = (req: Request): Promise<Response> => handleConsent(req, routeDeps);
