/**
 * Original files of appointment documents, in the private Storage bucket `appointment-docs`.
 * Path: <owner id>/<appointment id>/<document id>. Server side only, with the signed-in person's own client: the Storage
 * policies (migration 20261106100000) decide, so no path can reach another person's folder.
 * Rows in storage.objects cannot be deleted from SQL (the file would stay), so every removal goes through the Storage API.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const DOC_BUCKET = 'appointment-docs';
type StorageHost = Pick<SupabaseClient, 'storage'>;

export const docPath = (userId: string, apptId: string, docId: string): string => `${userId}/${apptId}/${docId}`;

const MAX_ROUNDS = 50;

/** Removes every file under `prefix` (one folder level). Throws if the Storage API refuses or the folder will not empty. */
export async function removeFolder(host: StorageHost, prefix: string): Promise<void> {
  const bucket = host.storage.from(DOC_BUCKET);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { data, error } = await bucket.list(prefix, { limit: 100 });
    if (error) throw new Error('storage_list');
    const files = (data ?? []).filter((f) => f.id !== null).map((f) => `${prefix}/${f.name}`);
    if (files.length === 0) return;
    const removed = await bucket.remove(files);
    if (removed.error) throw new Error('storage_remove');
  }
  throw new Error('storage_not_empty');
}

/** Removes everything a person has stored: each appointment folder, and any file loose in their own folder. */
export async function removeAllFiles(host: StorageHost, userId: string): Promise<void> {
  const bucket = host.storage.from(DOC_BUCKET);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { data, error } = await bucket.list(userId, { limit: 100 });
    if (error) throw new Error('storage_list');
    const entries = data ?? [];
    if (entries.length === 0) return;
    for (const e of entries) {
      if (e.id === null) await removeFolder(host, `${userId}/${e.name}`);
      else if ((await bucket.remove([`${userId}/${e.name}`])).error) throw new Error('storage_remove');
    }
  }
  throw new Error('storage_not_empty');
}

/** First bytes of the file must match the type it claims, so a page or script cannot be stored as a picture. */
export function matchesType(type: string, b: Uint8Array): boolean {
  const at = (sig: number[], off = 0): boolean => sig.every((v, i) => b[off + i] === v);
  switch (type) {
    case 'image/jpeg':
      return at([0xff, 0xd8, 0xff]);
    case 'image/png':
      return at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8);
    case 'application/pdf':
      return at([0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'text/plain':
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(b);
        return !b.includes(0);
      } catch {
        return false;
      }
    default:
      return false;
  }
}
