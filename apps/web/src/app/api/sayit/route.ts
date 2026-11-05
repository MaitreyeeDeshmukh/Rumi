import { sayitSpec } from '@/features/sayit/spec';
import { runTask } from '@/lib/ai/harness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (req: Request) => runTask(sayitSpec, req);
