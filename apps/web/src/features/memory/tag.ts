/**
 * The Supermemory container tag of one person: HMAC-SHA256(MEMORY_TAG_SECRET, Supabase user id). Server only.
 * Supermemory never sees the user id, and the tag cannot be worked out without the secret. The secret is passed in
 * because only lib/env.ts reads process.env.
 */
import { createHmac } from 'node:crypto';

export function tagForUser(userId: string, secret: string): string {
  if (typeof userId !== 'string' || userId.length < 1 || typeof secret !== 'string' || secret.trim().length < 32) throw new Error('bad memory key');
  return `u_${createHmac('sha256', secret).update(userId).digest('hex').slice(0, 32)}`;
}
