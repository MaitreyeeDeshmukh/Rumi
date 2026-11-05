import type { PersonaFact } from '@/features/shared/types';

/** Contract 00 section 4.5. Sujal implements, Rudheer's harness calls. */
export interface MemoryStore {
  upsertFacts(tag: string, facts: PersonaFact[]): Promise<void>;
  search(tag: string, query: string, limit: number): Promise<string[]>; // fact texts, best first
  forget(tag: string, factIds: string[]): Promise<void>;
}

/**
 * '' when no code, memory off, store down or slower than 1500 ms. Never throws. Returns a ready block:
 * "<user_memory>\n- ...\n</user_memory>". Implemented in ./context (a type here, so nothing imports an
 * undefined value at runtime).
 */
export type GetMemoryContext = (code: string | null, query: string) => Promise<string>;
