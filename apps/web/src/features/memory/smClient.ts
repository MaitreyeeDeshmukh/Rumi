/**
 * SERVER ONLY. Our own small Supermemory REST client (no package). Rules it keeps for every caller:
 *  - the namespace and the document id are checked against an allowlist in EVERY helper, before any request;
 *  - upsert is PATCH, and POST only on 404 (re-POST of an existing id appends, PATCH replaces);
 *  - metadata is flat and always sent in full (PATCH replaces metadata wholesale);
 *  - delete is done in batches of 100;
 *  - errors carry a status number and a fixed phrase, never the response body, the key or the underlying message.
 * Behaviour is from the Content OS probes (2026-10-21) and must be re-verified in the Phase 4 spike.
 */
import { z } from 'zod';

const SM_BASE = 'https://api.supermemory.ai';
export const NS_RE = /^[a-zA-Z0-9_:-]{1,100}$/;
/** No dots: encodeURIComponent('..') is '..' and would walk the path. */
const DOC_ID_RE = /^[A-Za-z0-9_:-]{1,100}$/;
const DELETE_BATCH = 100;
const LIST_PAGE_LIMIT = 100;
const MAX_LIST_PAGES = 50;
const MAX_CONTENT_CHARS = 500;
const DEFAULT_TIMEOUT_MS = 8000;

export type Flat = Record<string, string | number | boolean | string[]>;

export class SmError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SmError';
  }
}

export interface SmDoc {
  id: string;
  metadata?: Record<string, unknown>;
}
interface SmListPage {
  documents: SmDoc[];
  totalPages: number;
}
interface SmDeps {
  fetchFn: typeof fetch;
  apiKey: string;
  timeoutMs?: number;
}

export interface SmClient {
  add(ns: string, doc: { id: string; content: string; metadata: Flat }): Promise<void>;
  patch(ns: string, id: string, doc: { content: string; metadata: Flat }): Promise<void>;
  get(ns: string, id: string): Promise<SmDoc | null>;
  upsert(ns: string, id: string, doc: { content: string; metadata: Flat }): Promise<void>;
  del(ns: string, ids: readonly string[]): Promise<void>;
  listPage(ns: string, page: number): Promise<SmListPage>;
  listAll(ns: string): Promise<SmDoc[]>;
}

const ListResponse = z.object({
  documents: z.array(z.object({ id: z.string(), metadata: z.record(z.string(), z.unknown()).nullish() })),
  pagination: z.object({ totalPages: z.number().int().min(0) }).optional(),
});
const GetResponse = z.object({ id: z.string(), metadata: z.record(z.string(), z.unknown()).nullish() });

const isFlat = (m: unknown): m is Flat =>
  typeof m === 'object' &&
  m !== null &&
  !Array.isArray(m) &&
  Object.values(m).every((v) => ['string', 'number', 'boolean'].includes(typeof v) || (Array.isArray(v) && v.every((x) => typeof x === 'string')));

function checkNs(ns: string): string {
  if (!NS_RE.test(ns)) throw new Error('bad namespace');
  return ns;
}
function checkId(id: string): string {
  if (!DOC_ID_RE.test(id)) throw new Error('bad document id');
  return id;
}
function checkDoc(content: string, metadata: Flat): void {
  if (content.length < 1 || content.length > MAX_CONTENT_CHARS) throw new Error('bad content');
  if (!isFlat(metadata)) throw new Error('bad metadata');
}

export function createSmClient({ fetchFn, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS }: SmDeps): SmClient {
  if (!apiKey) throw new Error('Supermemory key missing');

  async function call(path: string, method: string, body?: unknown): Promise<{ status: number; data: unknown }> {
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, timeoutMs);
    try {
      const res = await fetchFn(`${SM_BASE}${path}`, {
        method,
        signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) throw new SmError('Supermemory request failed', res.status);
      const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
      return { status: res.status, data };
    } catch (e) {
      if (e instanceof SmError) throw e;
      throw new SmError(timedOut ? 'Supermemory timeout' : 'Supermemory network error', 0);
    } finally {
      clearTimeout(timer);
    }
  }

  const docPath = (ns: string, id?: string): string =>
    `/ns/${checkNs(ns)}/document${id === undefined ? '' : `/${encodeURIComponent(checkId(id))}`}`;

  async function add(ns: string, doc: { id: string; content: string; metadata: Flat }): Promise<void> {
    const path = docPath(ns);
    checkId(doc.id);
    checkDoc(doc.content, doc.metadata);
    await call(path, 'POST', { id: doc.id, content: doc.content, metadata: doc.metadata });
  }

  async function patch(ns: string, id: string, doc: { content: string; metadata: Flat }): Promise<void> {
    const path = docPath(ns, id);
    checkDoc(doc.content, doc.metadata);
    await call(path, 'PATCH', { content: doc.content, metadata: doc.metadata });
  }

  async function get(ns: string, id: string): Promise<SmDoc | null> {
    const path = docPath(ns, id);
    try {
      const { data } = await call(path, 'GET');
      const parsed = GetResponse.safeParse(data);
      if (!parsed.success) throw new SmError('Supermemory bad response', 200);
      return { id: parsed.data.id, ...(parsed.data.metadata ? { metadata: parsed.data.metadata } : {}) };
    } catch (e) {
      if (e instanceof SmError && e.status === 404) return null;
      throw e;
    }
  }

  async function upsert(ns: string, id: string, doc: { content: string; metadata: Flat }): Promise<void> {
    docPath(ns, id);
    try {
      await patch(ns, id, doc);
    } catch (e) {
      if (!(e instanceof SmError) || e.status !== 404) throw e;
      await add(ns, { ...doc, id });
    }
  }

  async function del(ns: string, ids: readonly string[]): Promise<void> {
    const path = docPath(ns);
    ids.forEach(checkId);
    for (let i = 0; i < ids.length; i += DELETE_BATCH) {
      await call(path, 'DELETE', { ids: ids.slice(i, i + DELETE_BATCH) });
    }
  }

  async function listPage(ns: string, page: number): Promise<SmListPage> {
    checkNs(ns);
    if (!Number.isInteger(page) || page < 1) throw new Error('bad page');
    const { data } = await call(`/ns/${ns}/list/documents?page=${page}&limit=${LIST_PAGE_LIMIT}`, 'POST', {});
    const parsed = ListResponse.safeParse(data);
    if (!parsed.success) throw new SmError('Supermemory bad response', 200);
    return {
      documents: parsed.data.documents.map((d) => ({ id: d.id, ...(d.metadata ? { metadata: d.metadata } : {}) })),
      totalPages: parsed.data.pagination?.totalPages ?? 1,
    };
  }

  async function listAll(ns: string): Promise<SmDoc[]> {
    checkNs(ns);
    const out: SmDoc[] = [];
    for (let page = 1; ; page++) {
      if (page > MAX_LIST_PAGES) throw new SmError('Supermemory list too long', 0);
      const { documents, totalPages } = await listPage(ns, page);
      out.push(...documents);
      if (page >= totalPages) return out;
    }
  }

  return { add, patch, get, upsert, del, listPage, listAll };
}
