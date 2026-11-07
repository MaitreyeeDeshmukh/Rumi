import { lookupHandler } from '@/lib/lookup/lookupHandler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const POST = (req: Request): Promise<Response> => lookupHandler(req);
