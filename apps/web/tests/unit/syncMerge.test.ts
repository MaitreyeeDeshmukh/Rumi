import { describe, expect, it } from "vitest";
import type { Appointment, RumiState } from "@/features/shared/types";
import { defaultState } from "@/lib/storage";
import { emptyMeta, markPushed, pending, reconcile, stamp, type SyncMeta } from "@/features/sync/merge";
import { parseRemote, type Remote, type WireAppointmentT, type WireChatT, type WireDocumentT } from "@/features/sync/wire";

const T0 = Date.parse("2026-11-01T10:00:00Z");
const iso = (ms: number): string => new Date(ms).toISOString();
const appt = (id: string, extra: Partial<Appointment> = {}): Appointment => ({
  id, care: "primary", providerName: "Dr Ray", clinic: "North clinic", date: "2026-12-01", time: "09:30", reason: "check", status: "to_confirm",
  createdAt: iso(T0), questions: [], bring: [], symptoms: [], ...extra,
});
const withAppts = (...a: Appointment[]): RumiState => ({ ...defaultState(), appointments: a });
const remote = (r: Partial<Remote> = {}): Remote => ({ appointments: [], documents: [], chats: [], unreadable: [], ...r });
const wireAppt = (a: Appointment, ms: number, deleted = false): WireAppointmentT => {
  const body = { ...a } as Record<string, unknown>;
  delete body.documents;
  return { id: a.id, body, created_at: iso(T0), updated_at: iso(ms), deleted };
};
/** A device whose state was pushed and accepted: everything is "sent". */
const synced = (s: RumiState): SyncMeta => {
  const m = stamp(s, emptyMeta("u"), T0);
  return markPushed(m, pending(s, m).sent);
};

describe("stamp", () => {
  it("marks new, edited and deleted records with the time of the change, and nothing else", () => {
    const a = appt("a1");
    const meta = synced(withAppts(a));
    expect(meta.records["a:a1"]).toMatchObject({ u: T0, s: true });
    expect(stamp(withAppts(a), meta, T0 + 5)).toBe(meta);

    const edited = stamp(withAppts({ ...a, reason: "new" }), meta, T0 + 10);
    expect(edited.records["a:a1"]).toMatchObject({ u: T0 + 10, s: false });

    const deleted = stamp(defaultState(), meta, T0 + 20);
    expect(deleted.records["a:a1"]).toMatchObject({ del: true, s: false, u: T0 + 20 });
  });

  it("does not turn a lost local cache into a delete of the whole cloud copy", () => {
    const all = Array.from({ length: 6 }, (_, i) => appt(`a${i}`));
    const meta = synced(withAppts(...all));
    const after = stamp(defaultState(), meta, T0 + 1);
    expect(Object.values(after.records).some((r) => r.del)).toBe(false);
    const back = reconcile(defaultState(), after, remote({ appointments: all.map((a) => wireAppt(a, T0)) }));
    expect(back.state.appointments).toHaveLength(6);
  });
});

describe("reconcile: last write wins", () => {
  it("adds a record that only the server has (new device)", () => {
    const r = reconcile(defaultState(), emptyMeta("u"), remote({ appointments: [wireAppt(appt("a9"), T0)] }));
    expect(r.changed).toBe(true);
    expect(r.state.appointments?.[0].id).toBe("a9");
    expect(r.meta.records["a:a9"]).toMatchObject({ s: true, u: T0 });
  });

  it("takes a newer server copy and keeps a newer local edit", () => {
    const a = appt("a1");
    const s = withAppts(a);
    const meta = synced(s);
    const newer = reconcile(s, meta, remote({ appointments: [wireAppt({ ...a, reason: "from phone" }, T0 + 1000)] }));
    expect(newer.state.appointments?.[0].reason).toBe("from phone");

    const edited = withAppts({ ...a, reason: "from laptop" });
    const dirty = stamp(edited, meta, T0 + 5000);
    const keep = reconcile(edited, dirty, remote({ appointments: [wireAppt({ ...a, reason: "from phone" }, T0 + 1000)] }));
    expect(keep.changed).toBe(false);
    expect(keep.state.appointments?.[0].reason).toBe("from laptop");
    expect(pending(edited, keep.meta).batches[0].appointments[0].body.reason).toBe("from laptop");
  });

  it("on a tie the server copy wins, so two devices end up the same", () => {
    const a = appt("a1");
    const meta = synced(withAppts(a));
    const edited = withAppts({ ...a, reason: "mine" });
    const dirty = stamp(edited, meta, T0 + 1000);
    const r = reconcile(edited, dirty, remote({ appointments: [wireAppt({ ...a, reason: "theirs" }, T0 + 1000)] }));
    expect(r.state.appointments?.[0].reason).toBe("theirs");
  });

  it("a newer delete on the server removes the record and its documents; an older one does not", () => {
    const a = appt("a1", { documents: [{ id: "d1", kind: "text", name: "letter", createdAt: iso(T0), excerpt: "bring ID", confirmed: true }] });
    const s = withAppts(a);
    const meta = synced(s);
    const gone = reconcile(s, meta, remote({ appointments: [wireAppt(a, T0 + 1, true)] }));
    expect(gone.state.appointments).toBeUndefined();
    expect(Object.keys(gone.meta.records)).toEqual([]);

    const edited = withAppts({ ...a, reason: "kept" });
    const kept = reconcile(edited, stamp(edited, meta, T0 + 9000), remote({ appointments: [wireAppt(a, T0 + 1000, true)] }));
    expect(kept.state.appointments?.[0].reason).toBe("kept");
  });

  it("drops a record the server no longer has when this device had agreed on it, but never one it could not read", () => {
    const s = withAppts(appt("a1"));
    const meta = synced(s);
    expect(reconcile(s, meta, remote()).state.appointments).toBeUndefined();
    expect(reconcile(s, meta, remote({ unreadable: ["a:a1"] })).state.appointments).toHaveLength(1);
    const fresh = stamp(s, emptyMeta("u"), T0);
    expect(reconcile(s, fresh, remote()).state.appointments).toHaveLength(1);
  });

  it("applies a document under its appointment, and skips one whose appointment is missing", () => {
    const doc: WireDocumentT = { id: "d1", appt_id: "a1", kind: "text", name: "n", excerpt: "e", confirmed: true, created_at: iso(T0), updated_at: iso(T0), deleted: false };
    expect(reconcile(defaultState(), emptyMeta("u"), remote({ documents: [doc] })).changed).toBe(false);
    const ok = reconcile(defaultState(), emptyMeta("u"), remote({ appointments: [wireAppt(appt("a1"), T0)], documents: [doc] }));
    expect(ok.state.appointments?.[0].documents?.[0]).toMatchObject({ id: "d1", excerpt: "e" });
  });

  it("respects the device caps instead of deleting what it cannot hold", () => {
    const many = Array.from({ length: 55 }, (_, i) => wireAppt(appt(`a${i}`), T0));
    const r = reconcile(defaultState(), emptyMeta("u"), remote({ appointments: many }));
    expect(r.state.appointments).toHaveLength(50);
    expect(Object.keys(r.meta.records)).toHaveLength(50);
  });

  it("adds a chat thread with its lines", () => {
    const chat: WireChatT = { id: "c1", kind: "get-ready", appt_id: null, created_at: iso(T0), updated_at: iso(T0), deleted: false, messages: [{ role: "me", text: "hi" }, { role: "rumi", text: "hello" }] };
    const r = reconcile(defaultState(), emptyMeta("u"), remote({ chats: [chat] }));
    expect(r.state.chats?.[0].messages).toHaveLength(2);
  });
});

describe("pending", () => {
  it("sends only unsent records, appointments before their documents, and tombstones without content", () => {
    const a = appt("a1", { documents: [{ id: "d1", kind: "text", name: "letter", createdAt: iso(T0), excerpt: "secret words", confirmed: false }] });
    const s = withAppts(a);
    const meta = stamp(s, emptyMeta("u"), T0);
    const p = pending(s, meta);
    expect(p.batches).toHaveLength(1);
    expect(p.batches[0].appointments.map((x) => x.id)).toEqual(["a1"]);
    expect(p.batches[0].documents[0]).toMatchObject({ id: "d1", appt_id: "a1" });
    expect(p.batches[0].appointments[0].body).not.toHaveProperty("documents");

    const sent = markPushed(meta, p.sent);
    expect(pending(s, sent).batches).toEqual([]);

    const del = pending(defaultState(), stamp(defaultState(), sent, T0 + 1));
    expect(JSON.stringify(del.batches)).not.toContain("secret words");
    expect(del.batches[0].documents[0]).toMatchObject({ deleted: true, appt_id: "a1", excerpt: "" });
    expect(del.batches[0].appointments[0]).toMatchObject({ deleted: true, body: {} });
  });

  it("a record changed while the push ran stays unsent", () => {
    const a = appt("a1");
    const meta = stamp(withAppts(a), emptyMeta("u"), T0);
    const p = pending(withAppts(a), meta);
    const changed = stamp(withAppts({ ...a, reason: "later" }), meta, T0 + 1);
    expect(markPushed(changed, p.sent).records["a:a1"].s).toBe(false);
  });

  it("cuts a big backlog into batches under the size limit", () => {
    const text = "w".repeat(1200);
    const chats = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`, kind: "get-ready" as const, createdAt: iso(T0), updatedAt: iso(T0),
      messages: Array.from({ length: 40 }, () => ({ role: "me" as const, text })),
    }));
    const s: RumiState = { ...defaultState(), chats };
    const p = pending(s, stamp(s, emptyMeta("u"), T0));
    expect(p.batches.length).toBeGreaterThan(1);
    expect(p.batches.flatMap((b) => b.chats)).toHaveLength(30);
    for (const b of p.batches) expect(JSON.stringify(b).length).toBeLessThan(450_000);
  });
});

describe("parseRemote", () => {
  it("keeps readable records, lists unreadable ones by key, and rejects a non-answer", () => {
    expect(parseRemote("nope")).toBeNull();
    const r = parseRemote({ appointments: [wireAppt(appt("a1"), T0), { id: "a2", body: "bad" }], documents: [], chats: [] });
    expect(r?.appointments).toHaveLength(1);
    expect(r?.unreadable).toEqual(["a:a2"]);
  });
});
