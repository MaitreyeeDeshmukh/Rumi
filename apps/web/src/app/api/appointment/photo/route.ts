import { photoHandler } from '@/lib/vision/photoHandler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const POST = (req: Request): Promise<Response> => photoHandler(req);
