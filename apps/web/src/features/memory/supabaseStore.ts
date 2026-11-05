/**
 * Persona store on Supabase `persona_facts` (migration 2). Server side only: the browser talks to our routes.
 * The client is user-scoped, so RLS decides who may do what; no service-role key is ever used here.
 *  - Writes go through `persona_upsert_facts` (last write wins on client_updated_at; consent is enforced by RLS).
 *  - Erasure is `persona_forget_all` and is only reported done when it says zero rows remain.
 *  - Every call has a timeout and one retry for faults that may clear (5xx, 429, network, timeout). A caller fault
 *    (4xx, constraint) is never retried. The database's message is dropped; only a reason code leaves this file.
 *  - `getMemoryContext` is the read path used by AI routes: it never throws and gives up after 1500 ms.
 */
import { STATED_FACT_KINDS } from '@/features/shared/constants';
import { PersonaFactSync, type PersonaFactRemovalT } from '@/features/shared/schemas';
import { getFlag } from '@/lib/ai/flags';
import { createLogger, type Logger } from '@/lib/log';
import { getServerClient } from '@/lib/supabase/server';
import { factStrings } from './factText';
import { cleanRows } from './sanitize';
import { MemoryStoreError, type DbError, type DbResult, type MemoryDb, type MemoryStore, type StoredFact } from './types';

export const CONSENT_POLICY_VERSION = 'persona-2026-11';
const CALL_TIMEOUT_MS = 4000;
export const CONTEXT_TIMEOUT_MS = 1500;
const MAX_CONTEXT_FACTS = 20;
const STATED: ReadonlySet<string> = new Set(STATED_FACT_KINDS);

export interface StoreOptions {
  /** Longest wait for one database call. */
  timeoutMs?: number;
  /** 1 turns the retry off (the prompt path has no time for it). Default 2. */
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 0 to 1, for the retry delay. */
  random?: () => number;
  now?: () => number;
}

type Verdict = 'consent' | 'unauthorized' | 'caller' | 'retry';

/** What a database error means. Unknown errors may clear on their own, so they are retried once. */
function classify(e: DbError): Verdict {
  if (e.code === '42501') return 'consent'; // insufficient_privilege: the RLS policy refused the row
  if (e.status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303') return 'unauthorized';
  if (e.status === 429 || (e.status !== undefined && e.status >= 500)) return 'retry';
  if (e.code === '57014' || e.code === '40001' || e.code === '40P01') return 'retry'; // timeout, serialisation, deadlock
  if (/^(22|23|42)/.test(e.code ?? '') || (e.status !== undefined && e.status >= 400)) return 'caller';
  return 'retry';
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = Promise.resolve(work);
  pending.catch(() => undefined); // if the timer wins, this call may still fail later; nobody is waiting for it
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MemoryStoreError('timeout')), ms);
  });
  return Promise.race([pending, clock]).finally(() => clearTimeout(timer));
}

export function createSupabaseStore(db: MemoryDb, userId: string, options: StoreOptions = {}): MemoryStore {
  const { timeoutMs = CALL_TIMEOUT_MS, attempts = 2, sleep = realSleep, random = Math.random, now = Date.now } = options;

  async function call(op: () => PromiseLike<DbResult<unknown>>): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      let failure: MemoryStoreError;
      try {
        const res = await withTimeout(op(), timeoutMs);
        if (!res.error) return res.data;
        const verdict = classify(res.error);
        if (verdict === 'consent') throw new MemoryStoreError('consent_required');
        if (verdict === 'unauthorized') throw new MemoryStoreError('unauthorized');
        if (verdict === 'caller') throw new MemoryStoreError('invalid');
        failure = new MemoryStoreError('unavailable');
      } catch (e) {
        if (!(e instanceof MemoryStoreError)) {
          failure = new MemoryStoreError('unavailable'); // the client itself threw: network, DNS, bad response
        } else if (e.reason === 'timeout') {
          failure = e;
        } else {
          throw e;
        }
      }
      if (attempt >= attempts) throw failure;
      await sleep(100 + Math.floor(random() * 200)); // jittered, so two devices do not retry in step
    }
  }

  return {
    async upsertFacts(facts) {
      // One row per (kind, key): the newest stamp wins, so a repeated fact cannot make the batch fail inside Postgres.
      const latest = new Map<string, StoredFact>();
      for (const raw of facts) {
        const parsed = PersonaFactSync.safeParse(raw);
        if (!parsed.success) throw new MemoryStoreError('invalid');
        const f = parsed.data;
        const id = `${f.kind}:${f.key}`;
        const held = latest.get(id);
        if (!held || Date.parse(f.client_updated_at) > Date.parse(held.client_updated_at)) latest.set(id, f);
      }
      // Only 11 distinct facts exist (a test pins that), so one call always stays under the database's cap of 100.
      const data = await call(() => db.rpc('persona_upsert_facts', { p_facts: [...latest.values()] }));
      if (typeof data !== 'number' || !Number.isInteger(data) || data < 0) throw new MemoryStoreError('unavailable');
      return data;
    },

    async removeFacts(removals: readonly PersonaFactRemovalT[]) {
      for (const r of removals) {
        await call(() =>
          db.from('persona_facts').delete().eq('owner_id', userId).eq('kind', r.kind).eq('key', r.key).lt('client_updated_at', r.client_updated_at),
        );
      }
    },

    async search() {
      const data = await call(() =>
        db.from('persona_facts').select('kind,key,level,client_updated_at').eq('owner_id', userId).limit(100),
      );
      if (!Array.isArray(data)) throw new MemoryStoreError('unavailable');
      return cleanRows(data);
    },

    async forget() {
      // A second pass catches a write that landed between the delete and the count. Anything left is a failure.
      for (let pass = 1; pass <= 2; pass++) {
        const remaining = await call(() => db.rpc('persona_forget_all'));
        if (typeof remaining !== 'number' || !Number.isInteger(remaining) || remaining < 0) throw new MemoryStoreError('unavailable');
        if (remaining === 0) return;
      }
      throw new MemoryStoreError('erasure_incomplete');
    },

    async setConsent(granted) {
      const at = new Date(now()).toISOString();
      await call(() =>
        db
          .from('core_consents')
          .upsert(
            { owner_id: userId, kind: 'persona_memory', granted, policy_version: CONSENT_POLICY_VERSION, granted_at: granted ? at : null, updated_at: at },
            { onConflict: 'owner_id,kind' },
          ),
      );
    },

    async hasConsent() {
      const data = await call(() => db.from('core_consents').select('granted').eq('owner_id', userId).eq('kind', 'persona_memory').limit(1));
      return Array.isArray(data) && (data[0] as { granted?: unknown } | undefined)?.granted === true;
    },
  };
}

export interface ContextDeps {
  getFlag?: (key: 'memory_sync_enabled') => Promise<boolean>;
  getDb?: () => Promise<MemoryDb>;
  log?: Logger;
  timeoutMs?: number;
}

/**
 * The sentences a prompt may use for this person, from stated kinds only (`help_level` is read by code, never a prompt).
 * Never throws. Empty on: flag off, consent off, store error, timeout. Waits at most 1500 ms.
 */
export async function getMemoryFacts(userId: string, deps: ContextDeps = {}): Promise<string[]> {
  const {
    getFlag: flag = getFlag,
    getDb = async () => (await getServerClient()) as unknown as MemoryDb,
    log = createLogger({ requestId: 'none', route: 'memory_context' }),
    timeoutMs = CONTEXT_TIMEOUT_MS,
  } = deps;

  const skip = (reason: string): string[] => {
    log.info('memory_context_empty', { reason });
    return [];
  };
  const work = async (): Promise<string[]> => {
    if (!(await flag('memory_sync_enabled'))) return skip('flag_off');
    const store = createSupabaseStore(await getDb(), userId, { attempts: 1, timeoutMs });
    const [consent, found] = await Promise.all([store.hasConsent(), store.search()]);
    if (!consent) return skip('consent_off');
    if (found.rejected > 0) log.warn('memory_rows_rejected', { count: found.rejected });
    return factStrings(found.facts.filter((f) => STATED.has(f.kind)).slice(0, MAX_CONTEXT_FACTS));
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = work();
    run.catch(() => undefined); // if the timer wins, a late failure has no reader
    return await Promise.race([
      run,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new MemoryStoreError('timeout')), timeoutMs);
      }),
    ]);
  } catch (e) {
    log.warn('memory_context_failed', { reason: e instanceof MemoryStoreError ? e.reason : 'error' });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** A ready prompt block, or '' (see getMemoryFacts). */
export async function getMemoryContext(userId: string, deps: ContextDeps = {}): Promise<string> {
  const lines = await getMemoryFacts(userId, deps);
  return lines.length === 0 ? '' : `<user_memory>\n${lines.map((l) => `- ${l}`).join('\n')}\n</user_memory>`;
}
