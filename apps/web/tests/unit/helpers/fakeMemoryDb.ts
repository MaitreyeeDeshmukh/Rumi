import type { DbError, DbFilter, DbResult, DbTable, MemoryDb } from "@/features/memory/types";

interface Row {
  kind: string;
  key: string;
  level: number | null;
  client_updated_at: string;
}

export interface FakeMemoryDb extends MemoryDb {
  rows: Map<string, Row>;
  consent: boolean;
  /** Every call, in order: "rpc:persona_upsert_facts", "select:persona_facts", "delete:persona_facts", "upsert:core_consents". */
  calls: string[];
  /** Errors handed out one per call, oldest first, before the call does anything. `null` lets that call through. */
  script: (DbError | null | "throw")[];
  /** persona_forget_all reports this many rows left. */
  stuckRows: number;
  /** Every p_facts batch sent. */
  batches: unknown[][];
  /** Wait this long before each call answers. */
  delayMs: number;
}

/** PostgREST sends timestamptz in this form, not the ISO form we send. */
const asPg = (iso: string): string => iso.replace("Z", "000+00:00");

/**
 * A stand-in for the user-scoped Supabase client with the semantics of migration 2:
 * persona_upsert_facts is last-write-wins and refuses more than 100 and any write without consent (an EMPTY batch writes
 * no row, so row-level security never runs and it succeeds even with consent off, as in Postgres);
 * persona_forget_all deletes and reports what is left; deletes need no consent.
 */
export function fakeMemoryDb(): FakeMemoryDb {
  const db: FakeMemoryDb = {
    rows: new Map(),
    consent: false,
    calls: [],
    script: [],
    stuckRows: 0,
    batches: [],
    delayMs: 0,
    rpc,
    from,
  };
  const idOf = (r: { kind: string; key: string }): string => `${r.kind}:${r.key}`;

  async function gate(label: string): Promise<DbResult<unknown> | null> {
    db.calls.push(label);
    if (db.delayMs > 0) await new Promise((r) => setTimeout(r, db.delayMs));
    const next = db.script.shift();
    if (next === "throw") throw new TypeError("fetch failed");
    return next ? { data: null, error: next } : null;
  }

  async function rpc(fn: string, args?: Record<string, unknown>): Promise<DbResult<unknown>> {
    const refused = await gate(`rpc:${fn}`);
    if (refused) return refused;
    if (fn === "persona_forget_all") {
      if (db.stuckRows === 0) db.rows.clear();
      return { data: db.stuckRows, error: null };
    }
    if (fn !== "persona_upsert_facts") return { data: null, error: { code: "42883", status: 404 } };
    const facts = (args?.p_facts ?? []) as { kind: string; key: string; level?: number; client_updated_at: string }[];
    db.batches.push(facts);
    if (facts.length > 100) return { data: null, error: { code: "54000", status: 400 } };
    if (facts.length > 0 && !db.consent) return { data: null, error: { code: "42501", status: 403 } };
    if (new Set(facts.map(idOf)).size !== facts.length) return { data: null, error: { code: "21000", status: 400 } };
    let written = 0;
    for (const f of facts) {
      const held = db.rows.get(idOf(f));
      if (held && Date.parse(f.client_updated_at) <= Date.parse(held.client_updated_at)) continue;
      db.rows.set(idOf(f), { kind: f.kind, key: f.key, level: f.level ?? null, client_updated_at: f.client_updated_at });
      written++;
    }
    return { data: written, error: null };
  }

  function filter(label: string, run: (eq: Record<string, string>, lt: Record<string, string>, or: string | null) => DbResult<unknown>): DbFilter {
    const eq: Record<string, string> = {};
    const lt: Record<string, string> = {};
    let or: string | null = null;
    const f: DbFilter = {
      eq: (c, v) => ((eq[c] = v), f),
      lt: (c, v) => ((lt[c] = v), f),
      or: (groups) => ((or = groups), f),
      limit: () => f,
      then: (ok, bad) =>
        gate(label)
          .then((refused) => refused ?? run(eq, lt, or))
          .then(ok, bad),
    };
    return f;
  }

  function from(table: string): DbTable {
    return {
      select: () =>
        filter(`select:${table}`, () =>
          table === "persona_facts"
            ? { data: [...db.rows.values()].map((r) => ({ ...r, client_updated_at: asPg(r.client_updated_at) })), error: null }
            : { data: db.consent ? [{ granted: true }] : [{ granted: false }], error: null },
        ),
      delete: () =>
        filter(`delete:${table}`, (_eq, _lt, or) => {
          // or = "and(kind.eq.x,key.eq.y,client_updated_at.lt.T),and(...)": a row goes if any group matches.
          const groups = [...(or ?? "").matchAll(/and\(([^)]*)\)/g)].map((m) =>
            m[1].split(",").map((term) => {
              const [col, op, ...val] = term.split(".");
              return { col, op, val: val.join(".") };
            }),
          );
          for (const [id, r] of db.rows) {
            const hit = groups.some((g) =>
              g.every(({ col, op, val }) => (op === "eq" ? String(r[col as keyof Row]) === val : Date.parse(r.client_updated_at) < Date.parse(val))),
            );
            if (hit) db.rows.delete(id);
          }
          return { data: null, error: null };
        }),
      upsert: (row) =>
        gate(`upsert:${table}`).then((refused) => {
          if (refused) return refused;
          db.consent = row.granted === true;
          return { data: null, error: null };
        }),
    };
  }

  return db;
}
