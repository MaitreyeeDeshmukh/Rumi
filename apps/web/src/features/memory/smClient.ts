/**
 * Our own small Supermemory REST client (no package). It only runs on the server (it holds the API key);
 * a test proves no browser-side module imports it. Rules it keeps for every caller:
 *  - the namespace and any document id used IN A URL PATH are checked against an allowlist in EVERY helper,
 *    before any request (ids in a DELETE body are data, not path, so they are only length-checked);
 *  - upsert is PATCH, and POST only on 404 (re-POST of an existing id appends, PATCH replaces);
 *  - metadata is flat and always sent in full (PATCH replaces metadata wholesale);
 *  - delete is done in batches of 100 and the documented `{count, errors}` answer is checked: ids the server
 *    refused, or a batch it did not fully delete, are returned as `failed`, never silently counted as removed;
 *  - every call can be capped by a remaining-time budget, so a caller with a deadline cannot hang past it;
 *  - errors carry a status number and a fixed phrase, never the response body, the key or the inner message.
 * Behaviour is from the Content OS probes (2026-10-21) and must be re-verified in the Phase 4 spike.
 */
import { z } from 'zod';

const SM_BASE = 'https://api.supermemory.ai';
export const NS_RE = /^[a-zA-Z0-9_:-]{1,100}$/;
/** No dots: encodeURIComponent('..') is '..' and would walk the path. Only for ids that go in a URL path. */
const DOC_ID_RE = /^[A-Za-z0-9_:-]{1,100}$/;
const DELETE_BATCH = 100;
const LIST_PAGE_LIMIT = 100;
/** A page with more documents than this is not the page we asked for; treat it as a bad response. */
const MAX_DOCS_PER_PAGE = 1000;
const MAX_LIST_PAGES = 50;
const MAX_CONTENT_CHARS = 500;
const MAX_BODY_ID_CHARS = 200;
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
  /** Undefined when the answer has no pagination field; callers then page until an empty page. */
  totalPages: number | undefined;
}
interface SmDeps {
  fetchFn: typeof fetch;
  apiKey: string;
  timeoutMs?: number;
}

/** Milliseconds left for the caller's whole job. Each request is capped by it; at 0 or less nothing is sent. */
export type Budget = () => number;

export interface SmClient {
  add(ns: string, doc: { id: string; content: string; metadata: Flat }, budget?: Budget): Promise<void>;
  patch(ns: string, id: string, doc: { content: string; metadata: Flat }, budget?: Budget): Promise<void>;
  /** Resolves 'created' when it had to POST (the document did not exist), so callers can re-check for a race. */
  upsert(ns: string, id: string, doc: { content: string; metadata: Flat }, budget?: Budget): Promise<'patched' | 'created'>;
  /** `failed` lists ids the server refused or did not confirm. An empty list means every id was deleted. */
  del(ns: string, ids: readonly string[], budget?: Budget): Promise<{ failed: string[] }>;
  listPage(ns: string, page: number, budget?: Budget): Promise<SmListPage>;
  listAll(ns: string, budget?: Budget): Promise<SmDoc[]>;
}

const ListResponse = z.object({
  documents: z.array(z.object({ id: z.string(), metadata: z.record(z.string(), z.unknown()).nullish() })),
  pagination: z.object({ totalPages: z.number().int().min(0) }).optional(),
});
const DeleteResponse = z.object({
  count: z.number().int().min(0).optional(),
  errors: z.array(z.object({ id: z.string() })).optional(),
});

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

  async function call(path: string, method: string, body: unknown, budget?: Budget): Promise<unknown> {
    const left = budget ? budget() : Number.POSITIVE_INFINITY;
    if (left <= 0) throw new SmError('Supermemory budget used up', 0);
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        ctl.abort();
      },
      Math.min(timeoutMs, left),
    );
    try {
      const res = await fetchFn(`${SM_BASE}${path}`, {
        method,
        signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) throw new SmError('Supermemory request failed', res.status);
      return res.status === 204 ? null : await res.json().catch(() => null);
    } catch (e) {
      if (e instanceof SmError) throw e;
      throw new SmError(timedOut ? 'Supermemory timeout' : 'Supermemory network error', 0);
    } finally {
      clearTimeout(timer);
    }
  }

  const docPath = (ns: string, id?: string): string =>
    `/ns/${checkNs(ns)}/document${id === undefined ? '' : `/${encodeURIComponent(checkId(id))}`}`;

  async function add(ns: string, doc: { id: string; content: string; metadata: Flat }, budget?: Budget): Promise<void> {
    const path = docPath(ns);
    checkId(doc.id);
    checkDoc(doc.content, doc.metadata);
    await call(path, 'POST', { id: doc.id, content: doc.content, metadata: doc.metadata }, budget);
  }

  async function patch(ns: string, id: string, doc: { content: string; metadata: Flat }, budget?: Budget): Promise<void> {
    const path = docPath(ns, id);
    checkDoc(doc.content, doc.metadata);
    await call(path, 'PATCH', { content: doc.content, metadata: doc.metadata }, budget);
  }

  async function upsert(ns: string, id: string, doc: { content: string; metadata: Flat }, budget?: Budget): Promise<'patched' | 'created'> {
    docPath(ns, id);
    try {
      await patch(ns, id, doc, budget);
      return 'patched';
    } catch (e) {
      if (!(e instanceof SmError) || e.status !== 404) throw e;
      await add(ns, { ...doc, id }, budget);
      return 'created';
    }
  }

  async function del(ns: string, ids: readonly string[], budget?: Budget): Promise<{ failed: string[] }> {
    const path = docPath(ns);
    const failed: string[] = [];
    // Ids come from a listing and travel in the JSON body, so an odd id (dots, any characters) is still deletable.
    // Only an id that is not a sensible string is refused without a request.
    const sendable = ids.filter((id) => {
      const ok = typeof id === 'string' && id.length >= 1 && id.length <= MAX_BODY_ID_CHARS;
      if (!ok) failed.push(String(id).slice(0, 40));
      return ok;
    });
    for (let i = 0; i < sendable.length; i += DELETE_BATCH) {
      const batch = sendable.slice(i, i + DELETE_BATCH);
      const parsed = DeleteResponse.safeParse(await call(path, 'DELETE', { ids: batch }, budget));
      const refused = parsed.success ? (parsed.data.errors ?? []).map((e) => e.id) : [];
      const count = parsed.success ? parsed.data.count : undefined;
      if (refused.length > 0) failed.push(...refused);
      // The server says how many it deleted. Fewer than asked, with no ids named, means we cannot tell which.
      if (refused.length === 0 && count !== undefined && count < batch.length) failed.push(...batch);
    }
    return { failed };
  }

  async function listPage(ns: string, page: number, budget?: Budget): Promise<SmListPage> {
    checkNs(ns);
    if (!Number.isInteger(page) || page < 1) throw new Error('bad page');
    const parsed = ListResponse.safeParse(await call(`/ns/${ns}/list/documents?page=${page}&limit=${LIST_PAGE_LIMIT}`, 'POST', {}, budget));
    if (!parsed.success || parsed.data.documents.length > MAX_DOCS_PER_PAGE) throw new SmError('Supermemory bad response', 200);
    return {
      documents: parsed.data.documents.map((d) => ({ id: d.id, ...(d.metadata ? { metadata: d.metadata } : {}) })),
      totalPages: parsed.data.pagination?.totalPages,
    };
  }

  async function listAll(ns: string, budget?: Budget): Promise<SmDoc[]> {
    checkNs(ns);
    const out: SmDoc[] = [];
    for (let page = 1; ; page++) {
      if (page > MAX_LIST_PAGES) throw new SmError('Supermemory list too long', 0);
      const { documents, totalPages } = await listPage(ns, page, budget);
      out.push(...documents);
      // A missing pagination field must not read as "one page": keep paging until a page comes back empty.
      if (documents.length === 0 || (totalPages !== undefined && page >= totalPages)) return out;
    }
  }

  return { add, patch, upsert, del, listPage, listAll };
}
