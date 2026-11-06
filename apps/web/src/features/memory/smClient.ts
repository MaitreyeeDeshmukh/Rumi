/**
 * Small Supermemory REST client (plain fetch, no package). Server only: it holds the API key.
 * Shapes checked against the live API on 2026-11-05 (docs: supermemory.ai/docs/api-reference):
 *  add     POST   /v3/documents          {content, containerTag, customId, metadata}  -> {id, status}
 *  search  POST   /v4/search             {q, containerTag, limit, threshold, searchMode:"hybrid"} -> {results:[{chunk, metadata, similarity}]}
 *  list    POST   /v3/documents/list     {containerTags, page, limit} -> {memories:[{id, customId}], pagination:{totalPages}}
 *  delete  DELETE /v3/documents/bulk     {ids} (1-100) -> {success, deletedCount, errors?}
 * Errors carry a status number and a fixed phrase, never the response body or the key.
 */
export class SmError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SmError';
  }
}

const BASE = 'https://api.supermemory.ai';
const TAG_RE = /^[a-zA-Z0-9_:-]{1,100}$/;
const ID_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const PAGE = 100;
const MAX_PAGES = 20;

export type Flat = Record<string, string | number | boolean>;
export interface SmDoc {
  id: string;
  customId?: string;
}
export interface SmClient {
  add(tag: string, doc: { customId: string; content: string; metadata: Flat }, timeoutMs?: number): Promise<void>;
  /** Metadata of each hit, best first. The hit's text is not returned: callers rebuild text from fixed tables. */
  search(tag: string, q: string, limit: number, timeoutMs?: number): Promise<Record<string, unknown>[]>;
  listAll(tag: string, timeoutMs?: number): Promise<SmDoc[]>;
  /** Ids the server refused (or a batch it did not confirm). */
  del(ids: readonly string[], timeoutMs?: number): Promise<string[]>;
}

export function createSmClient({ fetchFn, apiKey, defaultTimeoutMs = 8000 }: { fetchFn: typeof fetch; apiKey: string; defaultTimeoutMs?: number }): SmClient {
  if (!apiKey) throw new Error('Supermemory key missing');

  async function call(path: string, method: string, body: unknown, timeoutMs = defaultTimeoutMs): Promise<unknown> {
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, timeoutMs);
    try {
      const res = await fetchFn(`${BASE}${path}`, {
        method,
        signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new SmError('Supermemory request failed', res.status);
      return await res.json().catch(() => null);
    } catch (e) {
      if (e instanceof SmError) throw e;
      throw new SmError(timedOut ? 'Supermemory timeout' : 'Supermemory network error', 0);
    } finally {
      clearTimeout(timer);
    }
  }
  const tagOf = (t: string): string => {
    if (!TAG_RE.test(t)) throw new Error('bad tag');
    return t;
  };
  const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

  return {
    async add(tag, doc, timeoutMs) {
      if (!ID_RE.test(doc.customId) || doc.content.length < 1 || doc.content.length > 500) throw new Error('bad document');
      await call('/v3/documents', 'POST', { content: doc.content, containerTag: tagOf(tag), customId: doc.customId, metadata: doc.metadata }, timeoutMs);
    },
    async search(tag, q, limit, timeoutMs) {
      const res = await call('/v4/search', 'POST', { q: q.slice(0, 300), containerTag: tagOf(tag), limit, threshold: 0.1, searchMode: 'hybrid' }, timeoutMs);
      const results = isRec(res) && Array.isArray(res.results) ? res.results : null;
      if (!results) throw new SmError('Supermemory bad response', 200);
      return results.flatMap((r) => (isRec(r) && isRec(r.metadata) ? [r.metadata] : []));
    },
    async listAll(tag, timeoutMs) {
      tagOf(tag);
      const out: SmDoc[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await call('/v3/documents/list', 'POST', { containerTags: [tag], page, limit: PAGE }, timeoutMs);
        const docs = isRec(res) && Array.isArray(res.memories) ? res.memories : null;
        if (!docs) throw new SmError('Supermemory bad response', 200);
        for (const d of docs) if (isRec(d) && typeof d.id === 'string') out.push({ id: d.id, ...(typeof d.customId === 'string' ? { customId: d.customId } : {}) });
        const pages = isRec(res) && isRec(res.pagination) && typeof res.pagination.totalPages === 'number' ? res.pagination.totalPages : undefined;
        if (docs.length === 0 || (pages !== undefined && page >= pages)) return out;
      }
      throw new SmError('Supermemory list too long', 0);
    },
    async del(ids, timeoutMs) {
      const failed: string[] = [];
      for (let i = 0; i < ids.length; i += PAGE) {
        const batch = ids.slice(i, i + PAGE);
        const res = await call('/v3/documents/bulk', 'DELETE', { ids: batch }, timeoutMs);
        if (!isRec(res) || res.success !== true) failed.push(...batch);
        else if (Array.isArray(res.errors)) failed.push(...res.errors.flatMap((e) => (isRec(e) && typeof e.id === 'string' ? [e.id] : [])));
      }
      return failed;
    },
  };
}
