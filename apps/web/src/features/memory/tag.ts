/**
 * SERVER ONLY. Maps a recovery code to the Supermemory namespace. The secret is passed in because only
 * `lib/env.ts` may read process.env. Supermemory never sees the code; a breach there cannot be linked back.
 */
import { createHmac } from 'node:crypto';
import { isRecoveryCode } from './recoveryCode';

const MIN_TAG_SECRET_CHARS = 32;

export function tagFromCode(code: string, secret: string): string {
  if (!isRecoveryCode(code) || secret.length < MIN_TAG_SECRET_CHARS) throw new Error('bad memory key');
  return 'u_' + createHmac('sha256', secret).update(code).digest('hex').slice(0, 32);
}
