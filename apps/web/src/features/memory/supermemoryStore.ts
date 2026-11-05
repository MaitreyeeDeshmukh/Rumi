// Server only. Call shapes verified against supermemory@5.1.2 in the Nov 5 spike (see PR description).
import { Supermemory } from 'supermemory';
import type { PersonaFact } from '@/features/shared/types';
import type { MemoryStore } from './types';

interface CallOpts { maxRetries?: number; timeoutInSeconds?: number }
/** The part of the SDK we use. The real client satisfies it; tests pass a fake. */
export interface SmClient {
  add(ns: string, req: { content: string; id: string; metadata: Record<string, string>; taskType: 'superrag' }, opts?: CallOpts): Promise<unknown>;
  search(ns: string, req: { query: string; searchMode: 'chunks'; limit: number }, opts?: CallOpts): Promise<{ results: { chunk?: string; isInference: boolean }[] }>;
  documents: { delete(ns: string, req: { ids: string[] }, opts?: CallOpts): Promise<unknown> };
}

const isNotFound = (e: unknown): boolean => !!e && typeof e === 'object' && (e as { statusCode?: unknown }).statusCode === 404;

/**
 * - add with taskType 'superrag': Supermemory only chunks and embeds our sentence. The 'memory' pipeline
 *   runs its own model over the text (the spike saw it write a summary that misread a preference), and no
 *   model may infer facts about the user.
 * - search with searchMode 'chunks': returns our exact sentence in `chunk`, isInference false.
 * - delete with documents.delete(ns, { ids }): permanent, gone from search immediately in the spike.
 * - same id re-added = update in place, so upserts are idempotent.
 */
export class SupermemoryStore implements MemoryStore {
  private readonly c: SmClient;

  constructor(apiKey: string, client?: SmClient) {
    this.c = client ?? new Supermemory({ apiKey }); // type-checked: the real SDK must satisfy SmClient
  }

  async upsertFacts(tag: string, facts: PersonaFact[]): Promise<void> {
    await Promise.all(facts.map((f) => this.c.add(tag, {
      content: f.text, id: f.id, metadata: { kind: f.kind, key: f.key }, taskType: 'superrag',
    }, { timeoutInSeconds: 10 })));
  }

  async search(tag: string, query: string, limit: number): Promise<string[]> {
    try {
      // No retries: the caller has a 1500 ms budget (spike round trips 370-810 ms, one at 1638 ms).
      const res = await this.c.search(tag, { query, searchMode: 'chunks', limit }, { maxRetries: 0, timeoutInSeconds: 1.5 });
      return (res?.results ?? []).filter((r) => !r.isInference && typeof r.chunk === 'string').map((r) => r.chunk as string);
    } catch (e) {
      if (isNotFound(e)) return []; // nothing written for this tag yet
      throw e;
    }
  }

  async forget(tag: string, factIds: string[]): Promise<void> {
    if (!factIds.length) return;
    try {
      await this.c.documents.delete(tag, { ids: factIds }, { timeoutInSeconds: 10 });
    } catch (e) {
      if (!isNotFound(e)) throw e; // already gone is fine
    }
  }
}

/** In-memory store for tests and MOCK_AI=1. Same behavior as the real one: per-tag, upsert by id, text only. */
export class InMemoryStore implements MemoryStore {
  readonly data = new Map<string, Map<string, string>>();
  async upsertFacts(tag: string, facts: PersonaFact[]): Promise<void> {
    const m = this.data.get(tag) ?? new Map<string, string>();
    for (const f of facts) m.set(f.id, f.text);
    this.data.set(tag, m);
  }
  async search(tag: string, _query: string, limit: number): Promise<string[]> {
    return [...(this.data.get(tag)?.values() ?? [])].slice(0, limit);
  }
  async forget(tag: string, factIds: string[]): Promise<void> {
    for (const id of factIds) this.data.get(tag)?.delete(id);
  }
}
