/**
 * Maps a recovery code to the Supermemory namespace (server side; the browser never imports this, a test proves
 * it). The secret is passed in because only `lib/env.ts` may read process.env. Supermemory never sees the code;
 * a breach there cannot be linked back.
 */
import { createHmac } from 'node:crypto';
import { isRecoveryCode } from './recoveryCode';

const MIN_TAG_SECRET_CHARS = 32;

export function tagFromCode(code: string, secret: string): string {
  // typeof first: an unset env value arrives as undefined and must give the same clear error as a short secret.
  if (!isRecoveryCode(code) || typeof secret !== 'string' || secret.trim().length < MIN_TAG_SECRET_CHARS) throw new Error('bad memory key');
  return 'u_' + createHmac('sha256', secret).update(code).digest('hex').slice(0, 32);
}
