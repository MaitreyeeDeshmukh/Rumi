/**
 * Keeps the remote copy of a person's persona equal to the list the browser sent (server side; the browser
 * never imports this, a test proves it).
 *  - Only (kind, key, level) are accepted; the stored sentence is made by `factText`, so free text cannot get in.
 *  - Calls for one namespace in ONE PROCESS run one after another, so two syncs there cannot interleave. This is best
 *    effort: serverless runs several instances, and two of them can race a first write (both PATCH 404, both POST,
 *    content appended twice). So a document that had to be created is PATCHed once more with the canonical content,
 *    which heals the duplicate inside the same sync.
 *  - Facts are deduped by id and upserted one at a time; then remote ids that are not in the new set are deleted,
 *    so turning a preference off removes it remotely. A delete the server refused makes the sync FAIL, never ok.
 *  - Two devices sharing one recovery code are last-writer-wins: the latest sync decides the whole remote set.
 *  - `help_level` facts are synced because the contract allows them, but nothing reads them (D25: prompts use
 *    support_pref and pacing only). They are write-only until a screen or the database needs them.
 *  - Reads use metadata kind and key only (never stored content), limited to the stated kinds.
 */
import { LIMITS } from '@/features/shared/constants';
import { PersonaFactWire } from '@/features/shared/schemas';
import { factStrings, factText } from './factText';
import { SmError, type Flat, type SmClient, type SmDoc } from './smClient';

/** Runs jobs of one namespace in order. A failed job never blocks the next one. */
export type NamespaceQueue = <T>(ns: string, job: () => Promise<T>) => Promise<T>;

export function createNamespaceQueue(): NamespaceQueue {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(ns: string, job: () => Promise<T>): Promise<T> => {
    const run = (tails.get(ns) ?? Promise.resolve()).then(job);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    tails.set(ns, tail);
    void tail.then(() => {
      if (tails.get(ns) === tail) tails.delete(ns);
    });
    return run;
  };
}

export interface SyncResult {
  saved: number;
  rejected: number;
  removed: number;
}

/** Kinds that may be read back into a prompt. `help_level` is never read for prompts. */
const STATED_KINDS: ReadonlySet<string> = new Set(['support_pref', 'pacing']);
const MAX_STATED_DOCS = 20;

/** Sentences for a document list, from metadata only. Pure, so the read path is testable on its own. */
export function statedFactStrings(docs: readonly SmDoc[]): string[] {
  const picked: { kind: string; key: string; level?: number }[] = [];
  for (const d of docs) {
    const m = d.metadata;
    if (!m || !Object.hasOwn(m, 'kind') || !Object.hasOwn(m, 'key')) continue;
    const { kind, key, level } = m;
    if (typeof kind === 'string' && typeof key === 'string' && STATED_KINDS.has(kind)) {
      picked.push({ kind, key, ...(typeof level === 'number' ? { level } : {}) });
    }
  }
  return factStrings(picked.slice(0, MAX_STATED_DOCS));
}

/** `queue` is required: share the same instance with forgetNamespace so an erase waits for a running sync. */
export function createRemoteSync(client: SmClient, queue: NamespaceQueue) {
  /** Another instance may have created the same document at the same moment; one more PATCH leaves one canonical line. */
  async function healAfterCreate(ns: string, id: string, doc: { content: string; metadata: Flat }): Promise<void> {
    try {
      await client.patch(ns, id, doc);
    } catch (e) {
      // A just-created document may not be patchable yet; the next sync repairs it. Until then a duplicated line can
      // stay in the stored content. That is harmless: reads never use stored content, only metadata kind and key.
      // Anything other than a 404 is a real failure.
      if (!(e instanceof SmError) || e.status !== 404) throw e;
    }
  }

  function syncFacts(ns: string, facts: readonly unknown[]): Promise<SyncResult> {
    return queue(ns, async () => {
      const wanted = new Map<string, { content: string; metadata: Flat }>();
      let rejected = 0;
      for (const raw of facts.slice(0, LIMITS.factsMax)) {
        const parsed = PersonaFactWire.safeParse(raw);
        const content = parsed.success ? factText(parsed.data.kind, parsed.data.key, parsed.data.level) : null;
        if (!parsed.success || content === null) {
          rejected++;
          continue;
        }
        const { kind, key, level } = parsed.data;
        wanted.set(`${kind}:${key}`, { content, metadata: { kind, key, v: 1, ...(level === undefined ? {} : { level }) } });
      }
      rejected += Math.max(0, facts.length - LIMITS.factsMax);

      for (const [id, doc] of wanted) {
        if ((await client.upsert(ns, id, doc)) === 'created') await healAfterCreate(ns, id, doc);
      }

      const stale = (await client.listAll(ns)).map((d) => d.id).filter((id) => !wanted.has(id));
      const { failed } = await client.del(ns, stale);
      if (failed.length > 0) throw new SmError('Supermemory delete incomplete', 0);
      return { saved: wanted.size, rejected, removed: stale.length };
    });
  }

  /** The sentences a prompt may use for this namespace (stated kinds only). */
  async function readStatedFacts(ns: string): Promise<string[]> {
    return statedFactStrings(await client.listAll(ns));
  }

  return { syncFacts, readStatedFacts };
}
