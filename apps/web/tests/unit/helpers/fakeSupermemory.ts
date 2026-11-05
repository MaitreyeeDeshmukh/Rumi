/**
 * A fetch-level stand-in for the Supermemory REST API, following the recorded behaviour in 05 section 6:
 * re-POST of an existing id APPENDS content, PATCH replaces content and metadata wholesale, metadata must be flat,
 * delete takes at most 100 ids. Extra knobs let tests model slow deletes and documents that never go away.
 */
export interface SmCall {
  origin: string;
  method: string;
  path: string;
  query: string;
  body: unknown;
  auth: string | null;
}

export interface FakeDoc {
  content: string;
  metadata: Record<string, unknown>;
}

export interface FakeSm {
  fetchFn: typeof fetch;
  calls: SmCall[];
  /** namespace -> id -> doc */
  store: Map<string, Map<string, FakeDoc>>;
  /** After a delete, the next N list calls still show the deleted ids (slow delete). */
  deleteLag: number;
  /** Ids that a delete reports as done but that stay in the list. */
  stuckIds: Set<string>;
  /** When set, every request fails with this status. */
  failStatus: number | null;
  /** Body text echoed back on failures, so tests can prove errors never repeat it. */
  failBody: string;
  /** Pause before answering, in ms (use with a short client timeout). */
  delayMs: number;
  /** Newly created documents are not listed until `ms` have passed on `now` (indexing lag). */
  lag: { now: () => number; ms: number } | null;
  /** Called at the start of every request; tests use it to move a fake clock. */
  onRequest: (() => void) | null;
  /** Makes DELETE answer with this body and delete nothing (to model a server that refuses ids). */
  deleteReport: ((ids: string[], count: number) => unknown) | null;
  docs(ns: string): Map<string, FakeDoc>;
}

const flat = (m: unknown): boolean =>
  typeof m === "object" &&
  m !== null &&
  !Array.isArray(m) &&
  Object.values(m).every((v) => ["string", "number", "boolean"].includes(typeof v) || (Array.isArray(v) && v.every((x) => typeof x === "string")));

export function fakeSupermemory(): FakeSm {
  const sm: Omit<FakeSm, "fetchFn"> = {
    calls: [],
    store: new Map(),
    deleteLag: 0,
    stuckIds: new Set(),
    failStatus: null,
    failBody: "",
    delayMs: 0,
    lag: null,
    onRequest: null,
    deleteReport: null,
    docs(ns) {
      let d = sm.store.get(ns);
      if (!d) sm.store.set(ns, (d = new Map()));
      return d;
    },
  };
  const born = new Map<string, number>();
  const lagging = new Map<string, Map<string, FakeDoc>>();
  let lagLeft = 0;
  const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status });

  const handler = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : undefined;
    const headers = new Headers(init?.headers);
    sm.onRequest?.();
    sm.calls.push({ origin: url.origin, method, path: url.pathname, query: url.search, body, auth: headers.get("authorization") });
    if (sm.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, sm.delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    if (sm.failStatus) return new Response(sm.failBody, { status: sm.failStatus });

    const m = /^\/ns\/([^/]+)\/(document|list\/documents)(?:\/([^/]+))?$/.exec(url.pathname);
    if (!m) return json(404, { error: "no route" });
    const ns = decodeURIComponent(m[1]);
    const id = m[3] ? decodeURIComponent(m[3]) : undefined;
    const docs = sm.docs(ns);

    if (m[2] === "list/documents" && method === "POST") {
      const source = lagLeft > 0 && lagging.has(ns) ? (lagging.get(ns) as Map<string, FakeDoc>) : docs;
      if (lagLeft > 0) lagLeft--;
      const page = Number(url.searchParams.get("page") ?? 1);
      const limit = Number(url.searchParams.get("limit") ?? 100);
      const all = [...source.entries()].filter(([docId]) => {
        const at = born.get(ns + "/" + docId);
        return !(sm.lag && at !== undefined && sm.lag.now() - at < sm.lag.ms);
      });
      const slice = all.slice((page - 1) * limit, page * limit);
      return json(200, {
        documents: slice.map(([docId, d]) => ({ id: docId, metadata: d.metadata })),
        pagination: { totalPages: Math.max(1, Math.ceil(all.length / limit)), currentPage: page },
      });
    }
    if (m[2] !== "document") return json(404, {});

    if (method === "POST" && !id) {
      const b = body as { id?: string; content?: string; metadata?: unknown };
      if (!b.id || typeof b.content !== "string" || !flat(b.metadata)) return json(400, { error: "bad body" });
      const existing = docs.get(b.id);
      if (!existing && sm.lag) born.set(ns + "/" + b.id, sm.lag.now());
      docs.set(b.id, { content: existing ? existing.content + "\n" + b.content : b.content, metadata: b.metadata as Record<string, unknown> });
      return json(200, { id: b.id, status: "queued" });
    }
    if (method === "PATCH" && id) {
      const b = body as { content?: string; metadata?: unknown };
      if (!docs.has(id)) return json(404, { error: "not found" });
      if (typeof b.content !== "string" || !flat(b.metadata)) return json(400, { error: "bad body" });
      docs.set(id, { content: b.content, metadata: b.metadata as Record<string, unknown> });
      return json(200, { id, status: "queued" });
    }
    if (method === "GET" && id) {
      const d = docs.get(id);
      return d ? json(200, { id, content: d.content, metadata: d.metadata }) : json(404, { error: "not found" });
    }
    if (method === "DELETE" && !id) {
      const ids = (body as { ids?: string[] }).ids ?? [];
      if (ids.length > 100) return json(400, { error: "too many ids" });
      if (sm.deleteLag > 0) {
        lagging.set(ns, new Map(docs));
        lagLeft = sm.deleteLag;
      }
      if (sm.deleteReport) return json(200, sm.deleteReport(ids, 0)); // a server that answers without deleting
      let count = 0;
      for (const d of ids) {
        if (sm.stuckIds.has(d)) continue;
        if (docs.delete(d)) count++;
      }
      return json(200, { count, errors: [] });
    }
    return json(405, {});
  }) as typeof fetch;
  return Object.assign(sm, { fetchFn: handler });
}
