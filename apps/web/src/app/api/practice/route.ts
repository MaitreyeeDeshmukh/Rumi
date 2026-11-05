import { practiceSpec } from '@/features/practice/spec';
import { runTask } from '@/lib/ai/harness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export const POST = (req: Request) => runTask(practiceSpec, req);
