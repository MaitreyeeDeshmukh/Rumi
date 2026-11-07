/**
 * The sync rules as pure functions over (state, meta, remote). No network, no storage, no clock of their own.
 *
 * The device state stays the cache. `meta` remembers, per record, the fingerprint (`h`) it had when we last agreed with
 * the server, the time of the person's last change (`u`) and whether the server holds that version (`s`).
 *   stamp      notice what changed on this device (new, edited, deleted) and give it a change time
 *   reconcile  apply a pull: the newer change wins per record; a tie goes to the server copy so devices converge
 *   pending    the records the server has not seen yet, as push batches
 *   markPushed note which versions the server accepted
 * A record is an appointment, one of its documents, or a chat thread. Nothing is ever sent for a record that did not change.
 */
import type { Appointment, ApptDocument, ChatThread, RumiState } from '@/features/shared/types';
import { MAX_APPOINTMENTS, MAX_CHATS, MAX_DOCUMENTS } from '@/lib/storage-schema';
import { SYNC_LIMITS, cleanBody, cleanChat, emptyBatch, type PushBatchT, type Remote, type WireAppointmentT, type WireChatT, type WireDocumentT } from './wire';

export interface MetaRecord {
  /** Fingerprint of the local record when it was last stamped. Empty for a deleted record. */
  h: string;
  /** When the person last changed it (ms). */
  u: number;
  /** True when the server holds exactly this version. */
  s: boolean;
  /** Deleted on this device; the server has not been told yet. */
  del?: boolean;
  /** For a document: the appointment it belongs to (a delete still needs it). */
  p?: string;
}
export interface SyncMeta {
  v: 1;
  /** The account these records belong to. */
  userId: string;
  /** Sync is on for this account (the person agreed). A copy of the server's consent, so the screen can show it at once. */
  on: boolean;
  records: Record<string, MetaRecord>;
}
export const emptyMeta = (userId = ''): SyncMeta => ({ v: 1, userId, on: false, records: {} });

/** Fewer deletions than this at once are the person's own; this many or more with nothing left looks like a lost cache. */
const MASS_DELETE_GUARD = 5;

// ---------------------------------------------------------------------------------------------- fingerprints
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
/** cyrb53: a short, well-spread, non-secret fingerprint. Equal content gives an equal value. */
function fingerprint(v: unknown): string {
  const s = stable(v);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const withoutDocs = (a: Appointment): Omit<Appointment, 'documents'> => {
  const rest = { ...a };
  delete rest.documents;
  return rest;
};
const apptHash = (a: Appointment): string => fingerprint(withoutDocs(a));
const docHash = (apptId: string, d: ApptDocument): string => fingerprint({ apptId, ...d });
const chatHash = (c: ChatThread): string => fingerprint(c);

interface LocalItem {
  hash: string;
  parent?: string;
}
/** Every syncable record on this device, by key. */
function snapshot(state: RumiState): Map<string, LocalItem> {
  const out = new Map<string, LocalItem>();
  for (const a of state.appointments ?? []) {
    out.set(`a:${a.id}`, { hash: apptHash(a) });
    for (const d of a.documents ?? []) out.set(`d:${d.id}`, { hash: docHash(a.id, d), parent: a.id });
  }
  for (const c of state.chats ?? []) out.set(`c:${c.id}`, { hash: chatHash(c) });
  return out;
}

// ---------------------------------------------------------------------------------------------- stamp
/** Compares the device with what meta remembers and records every change with the time `now`. Safe to call on every change; returns the same object when nothing changed. */
export function stamp(state: RumiState, meta: SyncMeta, now: number): SyncMeta {
  const local = snapshot(state);
  const records = { ...meta.records };
  let dirty = false;
  for (const [key, it] of local) {
    const m = records[key];
    if (!m || m.h !== it.hash || m.del) {
      records[key] = { h: it.hash, u: now, s: false, ...(it.parent ? { p: it.parent } : {}) };
      dirty = true;
    }
  }
  const gone = Object.keys(records).filter((k) => !local.has(k) && !records[k].del);
  const known = Object.values(records).filter((m) => !m.del).length;
  if (!(local.size === 0 && known >= MASS_DELETE_GUARD)) { // else: see reconcile, the server copy comes back
    for (const key of gone) {
      records[key] = { h: '', u: now, s: false, del: true, ...(records[key].p ? { p: records[key].p } : {}) };
      dirty = true;
    }
  }
  return dirty ? { ...meta, records } : meta;
}

// ---------------------------------------------------------------------------------------------- reconcile
type Verdict = 'apply' | 'keep' | 'skip';
/** Who wins for one record. `ru` is the server's change time (ms). */
function decide(m: MetaRecord | undefined, ru: number, deleted: boolean, missingLocally: boolean): Verdict {
  if (!m) return deleted ? 'skip' : 'apply';
  if (m.del && deleted) return 'apply'; // both sides deleted it: just forget it
  if (m.s) return deleted || ru > m.u || missingLocally ? 'apply' : 'keep';
  return ru >= m.u ? 'apply' : 'keep';
}
const iso = (ms: number): string => new Date(ms).toISOString();

export interface Reconciled {
  state: RumiState;
  meta: SyncMeta;
  changed: boolean;
}

/** Applies a pull. The returned state is a copy; `changed` is false when the device already had everything. */
export function reconcile(state0: RumiState, meta0: SyncMeta, remote: Remote): Reconciled {
  const state = structuredClone(state0);
  const records = { ...meta0.records };
  let changed = false;
  const appts = (state.appointments ??= []);
  const chats = (state.chats ??= []);
  const seen = new Set<string>(remote.unreadable);

  for (const r of remote.appointments) {
    const key = `a:${r.id}`;
    seen.add(key);
    const at = appts.findIndex((a) => a.id === r.id);
    const ru = Date.parse(r.updated_at);
    const verdict = decide(records[key], ru, r.deleted, at < 0);
    if (verdict === 'skip') continue;
    if (verdict === 'keep') continue;
    if (r.deleted) {
      for (const d of appts[at]?.documents ?? []) delete records[`d:${d.id}`];
      if (at >= 0) appts.splice(at, 1);
      delete records[key];
      changed = true;
      continue;
    }
    const body = cleanBody(r.id, r.body);
    if (!body || (at < 0 && appts.length >= MAX_APPOINTMENTS)) continue;
    const next: Appointment = at >= 0 && appts[at].documents ? { ...body, documents: appts[at].documents } : body;
    if (at >= 0) appts[at] = next;
    else appts.push(next);
    records[key] = { h: apptHash(next), u: ru, s: true };
    changed = true;
  }

  for (const r of remote.documents) {
    const key = `d:${r.id}`;
    seen.add(key);
    const parent = appts.find((a) => a.id === r.appt_id);
    if (!parent) continue; // its appointment is not here (yet): leave it for a later pull
    const docs = (parent.documents ??= []);
    const at = docs.findIndex((d) => d.id === r.id);
    const ru = Date.parse(r.updated_at);
    const verdict = decide(records[key], ru, r.deleted, at < 0);
    if (verdict !== 'apply') continue;
    if (r.deleted) {
      if (at >= 0) docs.splice(at, 1);
      delete records[key];
      changed = true;
    } else if (at >= 0 || docs.length < MAX_DOCUMENTS) {
      const doc: ApptDocument = { id: r.id, kind: r.kind, name: r.name, createdAt: r.created_at, excerpt: r.excerpt, confirmed: r.confirmed };
      if (at >= 0) docs[at] = doc;
      else docs.push(doc);
      records[key] = { h: docHash(parent.id, doc), u: ru, s: true, p: parent.id };
      changed = true;
    }
    if (docs.length === 0) delete parent.documents;
  }

  for (const r of remote.chats) {
    const key = `c:${r.id}`;
    seen.add(key);
    const at = chats.findIndex((c) => c.id === r.id);
    const ru = Date.parse(r.updated_at);
    const verdict = decide(records[key], ru, r.deleted, at < 0);
    if (verdict !== 'apply') continue;
    if (r.deleted) {
      if (at >= 0) chats.splice(at, 1);
      delete records[key];
      changed = true;
      continue;
    }
    const thread = cleanChat(r);
    if (!thread || (at < 0 && chats.length >= MAX_CHATS)) continue;
    if (at >= 0) chats[at] = thread;
    else chats.push(thread);
    records[key] = { h: chatHash(thread), u: ru, s: true };
    changed = true;
  }

  // The server no longer holds a record this device had agreed on (erased or very old): drop it here too.
  // A deleted record the server forgot needs no telling any more.
  for (const [key, m] of Object.entries(records)) {
    if (seen.has(key) || !m.s) continue;
    const id = key.slice(2);
    if (key[0] === 'a') {
      const at = appts.findIndex((a) => a.id === id);
      if (at >= 0) { appts.splice(at, 1); changed = true; }
    } else if (key[0] === 'd') {
      const parent = appts.find((a) => a.id === m.p);
      if (parent?.documents) {
        parent.documents = parent.documents.filter((d) => d.id !== id);
        if (parent.documents.length === 0) delete parent.documents;
        changed = true;
      }
    } else {
      const at = chats.findIndex((c) => c.id === id);
      if (at >= 0) { chats.splice(at, 1); changed = true; }
    }
    delete records[key];
  }

  if (appts.length === 0) delete state.appointments;
  if (chats.length === 0) delete state.chats;
  return { state: changed ? state : state0, meta: { ...meta0, records }, changed };
}

// ---------------------------------------------------------------------------------------------- push
export interface Pending {
  /** Batches in the order they must be sent: appointments before the documents under them. */
  batches: PushBatchT[];
  /** key -> fingerprint of what was put in a batch, to be passed to markPushed after the server accepted it. */
  sent: Record<string, string>;
}

/** Everything the server has not seen, as wire records, cut into batches under the size and count limits. */
export function pending(state: RumiState, meta: SyncMeta): Pending {
  const wires: Array<{ kind: 'appointments' | 'documents' | 'chats'; rec: WireAppointmentT | WireDocumentT | WireChatT }> = [];
  const sent: Record<string, string> = {};
  const apptById = new Map((state.appointments ?? []).map((a) => [a.id, a]));
  const docById = new Map((state.appointments ?? []).flatMap((a) => (a.documents ?? []).map((d) => [d.id, { d, apptId: a.id }] as const)));
  const chatById = new Map((state.chats ?? []).map((c) => [c.id, c]));
  const stampOf = (m: MetaRecord, created?: string): { created_at: string; updated_at: string } => ({ created_at: validIso(created) ?? iso(m.u), updated_at: iso(m.u) });

  for (const [key, m] of Object.entries(meta.records)) {
    if (m.s) continue;
    const id = key.slice(2);
    const t = stampOf(m);
    if (key[0] === 'a') {
      const a = apptById.get(id);
      if (!m.del && !a) continue;
      wires.push({ kind: 'appointments', rec: { id, body: m.del || !a ? {} : { ...withoutDocs(a) }, ...(a ? stampOf(m, a.createdAt) : t), deleted: Boolean(m.del) } });
    } else if (key[0] === 'd') {
      const found = docById.get(id);
      const apptId = found?.apptId ?? m.p;
      if (!apptId) continue;
      const d = found?.d;
      wires.push({
        kind: 'documents',
        rec: { id, appt_id: apptId, kind: d?.kind ?? 'text', name: m.del || !d ? '' : d.name, excerpt: m.del || !d ? '' : d.excerpt, confirmed: m.del || !d ? false : d.confirmed, ...(d ? stampOf(m, d.createdAt) : t), deleted: Boolean(m.del) },
      });
    } else {
      const c = chatById.get(id);
      if (!m.del && !c) continue;
      wires.push({ kind: 'chats', rec: { id, kind: c?.kind ?? 'get-ready', appt_id: c?.apptId ?? null, ...(c ? stampOf(m, c.createdAt) : t), deleted: Boolean(m.del), messages: m.del || !c ? [] : c.messages } });
    }
    sent[key] = m.h;
  }

  const order = { appointments: 0, documents: 1, chats: 2 } as const;
  wires.sort((x, y) => order[x.kind] - order[y.kind]);
  const batches: PushBatchT[] = [];
  let cur = emptyBatch();
  let bytes = 0;
  const flush = (): void => {
    if (cur.appointments.length + cur.documents.length + cur.chats.length > 0) batches.push(cur);
    cur = emptyBatch();
    bytes = 0;
  };
  for (const w of wires) {
    const size = JSON.stringify(w.rec).length;
    const list = cur[w.kind] as unknown[];
    if (bytes + size > SYNC_LIMITS.batchBytes || list.length >= SYNC_LIMITS[w.kind]) flush();
    (cur[w.kind] as unknown[]).push(w.rec);
    bytes += size;
  }
  flush();
  return { batches, sent };
}

const validIso = (v: string | undefined): string | undefined => {
  if (!v) return undefined;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
};

/** The server accepted these versions. A record changed again while the push ran stays unsent. */
export function markPushed(meta: SyncMeta, sent: Record<string, string>): SyncMeta {
  const records = { ...meta.records };
  for (const [key, h] of Object.entries(sent)) {
    const m = records[key];
    if (!m || m.h !== h) continue;
    if (m.del) delete records[key];
    else records[key] = { ...m, s: true };
  }
  return { ...meta, records };
}
