// Server only: never import from client code.
import { createHmac } from 'node:crypto';
import { isRecoveryCode } from './recoveryCode';

export const MIN_SECRET_CHARS = 32;

/**
 * Supermemory namespace for a recovery code: 'u_' + first 32 hex chars of HMAC-SHA256(secret, code).
 * Supermemory never sees the code, so a breach there cannot be linked back to a person.
 * Throws on a malformed code or a missing/short secret; callers turn that into '' or a 400.
 */
export function deriveTag(code: string, secret: string | undefined): string {
  if (!isRecoveryCode(code) || !secret || secret.length < MIN_SECRET_CHARS) throw new Error('bad memory key');
  return 'u_' + createHmac('sha256', secret).update(code).digest('hex').slice(0, 32);
}
