/**
 * Contracts of the persona store (addendum section 3). The server talks to the database only through `MemoryDb`,
 * a narrow slice of the Supabase client, so this folder needs no Supabase types and a test can fake it.
 */
import type { PersonaFactRemovalT, PersonaFactSyncT } from '@/features/shared/schemas';

/** A fact as stored: preset ids and a level, plus when the person last changed it. No free text. */
export type StoredFact = PersonaFactSyncT;

export interface DbError {
  /** Postgres or PostgREST code, for example 42501 (RLS refused the row). */
  code?: string;
  /** HTTP status when the error came over the wire. 0 or missing: the network failed. */
  status?: number;
  /** Never read, logged or returned to a caller. */
  message?: string;
}
export interface DbResult<T> {
  data: T | null;
  error: DbError | null;
  status?: number;
}
export interface DbFilter extends PromiseLike<DbResult<unknown>> {
  eq(column: string, value: string): DbFilter;
  lt(column: string, value: string): DbFilter;
  /** PostgREST or-filter, for example `and(kind.eq.pacing,key.eq.extra_time),and(...)`. Built only from validated values. */
  or(filters: string): DbFilter;
  limit(count: number): DbFilter;
}
export interface DbTable {
  select(columns: string): DbFilter;
  upsert(row: Record<string, unknown>, options: { onConflict: string }): PromiseLike<DbResult<unknown>>;
  delete(): DbFilter;
}
export interface MemoryDb {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult<unknown>>;
  from(table: string): DbTable;
}

export type MemoryStoreReason = 'consent_required' | 'permission_denied' | 'unauthorized' | 'invalid' | 'timeout' | 'unavailable' | 'erasure_incomplete';

/** Carries a reason code only. The database's own message is never kept, so it cannot reach a log or a client. */
export class MemoryStoreError extends Error {
  constructor(readonly reason: MemoryStoreReason) {
    super(reason);
    this.name = 'MemoryStoreError';
  }
}

/** The signed-in person's persona. RLS scopes every call, so there is no id to pass in a call. */
export interface MemoryStore {
  /** Writes facts (batches of at most 100). Older-than-stored copies are ignored. Returns rows written. */
  upsertFacts(facts: readonly StoredFact[]): Promise<number>;
  /** Deletes stated facts turned off on a device, only where the stored copy is older than the removal. */
  removeFacts(removals: readonly PersonaFactRemovalT[]): Promise<void>;
  /** Lists the stored facts. Rows that fail the allowlist are counted in `rejected` and never returned. */
  search(): Promise<{ facts: StoredFact[]; rejected: number }>;
  /** Deletes everything and proves it: rejects with `erasure_incomplete` unless zero rows remain. */
  forget(): Promise<void>;
  setConsent(granted: boolean): Promise<void>;
  hasConsent(): Promise<boolean>;
}
