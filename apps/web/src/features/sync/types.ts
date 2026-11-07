/** The two small interfaces the rest of the app depends on. The browser uses the HTTP versions (client.ts); tests use fakes. */
import type { PushBatchT, Remote } from './wire';

/**
 *  consent  the account has not agreed (or took it back on another device)
 *  paused   the server's kill switch is on (`cloud_sync_enabled`)
 *  auth     not signed in, or the session is gone
 *  account  a guest account: sync needs an email account
 *  failed   anything else, including a dead network; worth trying again later
 */
export type SyncFailure = 'consent' | 'paused' | 'auth' | 'account' | 'failed';
export type Result<T> = { ok: true; data: T } | { ok: false; reason: SyncFailure };

/** Everything the sync engine needs from the server. */
export interface SyncRepository {
  getConsent(): Promise<Result<{ granted: boolean }>>;
  setConsent(granted: boolean): Promise<Result<{ granted: boolean }>>;
  pull(): Promise<Result<Remote>>;
  push(batch: PushBatchT): Promise<Result<{ written: number }>>;
  /** Erases the cloud copy: rows and files, and takes the consent back. */
  forget(): Promise<Result<null>>;
}

/**
 * The original files (photos, PDFs) of appointment documents. Kept apart from the text records: they live in a private
 * bucket, are only reached through the signed-in routes, and a link lasts one minute. Feature code (the scan flow) calls
 * this; it does not need to know about buckets or paths. A file can only be stored while sync is on.
 */
export interface DocumentStore {
  /** Stores or replaces the original. Types: JPEG, PNG, WebP, PDF, plain text. At most 4 MB. */
  upload(apptId: string, docId: string, file: Blob): Promise<Result<null>>;
  /** A link that opens the original for a short time. Do not store it. */
  signedUrl(apptId: string, docId: string): Promise<Result<{ url: string; expiresInSec: number }>>;
  remove(apptId: string, docId: string): Promise<Result<null>>;
}

export const DOC_LIMITS = { maxBytes: 4 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain'], urlSeconds: 60 } as const;
