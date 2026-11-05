// Server only. Rudheer's harness calls getMemoryContext (wired from createGetMemoryContext once env.ts has the keys).
import { isRecoveryCode } from './recoveryCode';
import { deriveTag } from './tag';
import type { GetMemoryContext, MemoryStore } from './types';

export const MEMORY_TIMEOUT_MS = 1500;
export const MEMORY_LIMIT = 6;

export interface ContextDeps {
  /** null when memory is not configured (no SUPERMEMORY_API_KEY). Called lazily, once per request. */
  store: () => MemoryStore | null;
  /** MEMORY_TAG_SECRET */
  secret: string | undefined;
  /** persona.sanitizeText: re-run on read so a poisoned fact can never reach a prompt. */
  sanitizeText: (t: unknown) => string | null;
  timeoutMs?: number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('memory timeout')), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export function createGetMemoryContext(deps: ContextDeps): GetMemoryContext {
  return async function getMemoryContext(code, query) {
    if (!isRecoveryCode(code) || !deps.secret) return '';
    try {
      const store = deps.store();
      if (!store) return '';
      const texts = await withTimeout(store.search(deriveTag(code, deps.secret), query.slice(0, 300), MEMORY_LIMIT), deps.timeoutMs ?? MEMORY_TIMEOUT_MS);
      const seen = new Set<string>();
      const clean = (Array.isArray(texts) ? texts : [])
        .map((t) => deps.sanitizeText(t))
        .filter((t): t is string => !!t && !seen.has(t) && !!seen.add(t))
        .slice(0, MEMORY_LIMIT);
      return clean.length ? `<user_memory>\n${clean.map((t) => `- ${t}`).join('\n')}\n</user_memory>` : '';
    } catch {
      return ''; // memory must never fail a request
    }
  };
}
