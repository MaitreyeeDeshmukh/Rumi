import { sttHandler } from '@/lib/voice/sttHandler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const POST = (req: Request): Promise<Response> => sttHandler(req);
