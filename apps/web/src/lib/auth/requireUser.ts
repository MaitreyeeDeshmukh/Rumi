// stub for lane merge: owned by prod-auth (frozen signature, addendum section 3). Delete this file at merge.
import { AppError } from '@/lib/errors';

export async function requireUser(_req: Request): Promise<{ userId: string; userHash: string; isAnonymous: boolean }> {
  throw new AppError('unauthorized', 401);
}
