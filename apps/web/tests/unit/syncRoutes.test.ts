import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { handleConsent, handleData, handleDoc, handleForget, type SyncDeps } from "@/features/sync/server";
import { matchesType } from "@/features/sync/files";

const ME = "00000000-0000-4000-8000-0000000000aa";
const T = "2026-11-01T10:00:00.000Z";

interface Fake {
  consent: boolean;
  rpc: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  signed: ReturnType<typeof vi.fn>;
  upserts: unknown[];
}
function setup(over: { anonymous?: boolean; flag?: boolean; consent?: boolean } = {}) {
  const f: Fake = {
    consent: over.consent ?? true,
    rpc: vi.fn(async (name: string) => (name === "sync_push" ? { data: 3, error: null } : name === "sync_forget_all" ? { data: 0, error: null } : { data: { appointments: [], documents: [], chats: [] }, error: null })),
    upload: vi.fn(async () => ({ error: null })),
    remove: vi.fn(async () => ({ error: null })),
    list: vi.fn(async () => ({ data: [], error: null })),
    signed: vi.fn(async () => ({ data: { signedUrl: "https://x.test/sign?t=1" }, error: null })),
    upserts: [],
  };
  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: [{ granted: f.consent }], error: null }) }) }) }),
      upsert: async (row: { granted: boolean }) => {
        f.upserts.push(row);
        f.consent = row.granted;
        return { error: null };
      },
    }),
    rpc: f.rpc,
    storage: { from: () => ({ upload: f.upload, remove: f.remove, list: f.list, createSignedUrl: f.signed }) },
  } as unknown as SupabaseClient;
  const deps: SyncDeps = {
    guard: async () => ({ userId: ME, isAnonymous: over.anonymous ?? false }),
    getClient: async () => client,
    getFlag: async () => over.flag ?? true,
    readJson: async (req) => req.json(),
    userLimit: () => undefined,
    now: () => Date.parse(T),
  };
  return { f, deps };
}
const req = (method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}): Request =>
  new Request(`https://rumi.test/api/sync/${path}`, { method, body, headers: { "x-request-id": "11111111-1111-4111-8111-111111111111", ...headers } });
const jreq = (method: string, path: string, body: unknown): Request => req(method, path, JSON.stringify(body), { "content-type": "application/json" });
const code = async (r: Response): Promise<string | undefined> => ((await r.clone().json()) as { error?: { code?: string } }).error?.code;

const appt = { id: "a1", body: { id: "a1", care: "primary", providerName: "Dr Ray", clinic: "C", date: "2026-12-01", time: "09:30", reason: "r", status: "to_confirm", createdAt: T, questions: [], bring: [], symptoms: [], injected: "<script>" }, created_at: T, updated_at: T, deleted: false };
const batch = (over: Record<string, unknown> = {}) => ({ appointments: [appt], documents: [], chats: [], ...over });

describe("who may use the sync routes", () => {
  it("a guest account gets account_required on every route", async () => {
    const { deps } = setup({ anonymous: true });
    for (const r of [handleConsent(req("GET", "consent"), deps), handleData(req("GET", "data"), deps), handleForget(jreq("POST", "forget", {}), deps), handleDoc(req("GET", "doc?appt=a&doc=d"), deps)]) {
      const res = await r;
      expect(res.status).toBe(403);
      expect(await code(res)).toBe("account_required");
    }
  });

  it("without consent, reading and writing content is refused with consent_required", async () => {
    const { deps, f } = setup({ consent: false });
    expect(await code(await handleData(req("GET", "data"), deps))).toBe("consent_required");
    expect(await code(await handleData(jreq("POST", "data", batch()), deps))).toBe("consent_required");
    expect(await code(await handleDoc(req("PUT", "doc?appt=a1&doc=d1", new Uint8Array([0xff, 0xd8, 0xff, 1]), { "content-type": "image/jpeg" }), deps))).toBe("consent_required");
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
  });

  it("the kill switch pauses reads, writes and turning on, but never turning off or erasing", async () => {
    const { deps } = setup({ flag: false });
    const paused = await handleData(req("GET", "data"), deps);
    expect(paused.status).toBe(503);
    expect(await code(paused)).toBe("sync_paused");
    expect(paused.headers.get("retry-after")).toBe("300");
    expect(await code(await handleConsent(jreq("POST", "consent", { granted: true }), deps))).toBe("sync_paused");
    expect((await handleConsent(jreq("POST", "consent", { granted: false }), deps)).status).toBe(200);
    expect((await handleForget(jreq("POST", "forget", {}), deps)).status).toBe(200);
  });
});

describe("consent and forget", () => {
  it("sets and reads the cloud_sync consent for the verified user only", async () => {
    const { deps, f } = setup({ consent: false });
    expect(await (await handleConsent(req("GET", "consent"), deps)).json()).toEqual({ granted: false });
    await handleConsent(jreq("POST", "consent", { granted: true }), deps);
    expect(f.upserts[0]).toMatchObject({ owner_id: ME, kind: "cloud_sync", granted: true });
    expect(await code(await handleConsent(jreq("POST", "consent", { granted: "yes", extra: 1 }), deps))).toBe("bad_input");
  });

  it("forget takes consent back first, erases rows, then files, and answers ok only when nothing is left", async () => {
    const { deps, f } = setup();
    f.list.mockResolvedValueOnce({ data: [{ name: "a1", id: null }], error: null }).mockResolvedValueOnce({ data: [{ name: "d1", id: "x" }], error: null });
    const order: string[] = [];
    f.rpc.mockImplementation(async (n: string) => (order.push(`${n}:${f.consent}`), { data: 0, error: null }));
    const res = await handleForget(jreq("POST", "forget", {}), deps);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(order).toEqual(["sync_forget_all:false"]);
    expect(f.remove).toHaveBeenCalledWith([`${ME}/a1/d1`]);
    expect(f.consent).toBe(false);

    f.rpc.mockResolvedValue({ data: 2, error: null }); // two rows left: not a success
    expect((await handleForget(jreq("POST", "forget", {}), deps)).status).toBe(503);
  });
});

describe("data", () => {
  it("stores only what the app's own reader keeps (unknown fields are removed)", async () => {
    const { deps, f } = setup();
    const res = await handleData(jreq("POST", "data", batch()), deps);
    expect(await res.json()).toEqual({ written: 3 });
    const sent = f.rpc.mock.calls[0][1].p_changes.appointments[0].body as Record<string, unknown>;
    expect(sent.providerName).toBe("Dr Ray");
    expect(sent).not.toHaveProperty("injected");
    expect(sent).not.toHaveProperty("documents");
  });

  it("refuses a body that is not the agreed shape, an invalid appointment, or a bad id", async () => {
    const { deps, f } = setup();
    expect(await code(await handleData(jreq("POST", "data", { appointments: "x" }), deps))).toBe("bad_input");
    expect(await code(await handleData(jreq("POST", "data", batch({ appointments: [{ ...appt, body: { nope: 1 } }] })), deps))).toBe("bad_input");
    expect(await code(await handleData(jreq("POST", "data", batch({ appointments: [{ ...appt, id: "../x" }] })), deps))).toBe("bad_input");
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("removes the files of a deleted appointment and of a deleted document, and fails the push if it cannot", async () => {
    const { deps, f } = setup();
    f.list.mockResolvedValueOnce({ data: [{ name: "d1", id: "x" }], error: null });
    const doc = { id: "d2", appt_id: "a2", kind: "image", name: "", excerpt: "", confirmed: false, created_at: T, updated_at: T, deleted: true };
    const res = await handleData(jreq("POST", "data", batch({ appointments: [{ ...appt, deleted: true }], documents: [doc] })), deps);
    expect(res.status).toBe(200);
    expect(f.remove).toHaveBeenCalledWith([`${ME}/a1/d1`]);
    expect(f.remove).toHaveBeenCalledWith([`${ME}/a2/d2`]);

    f.remove.mockResolvedValue({ error: { message: "secret detail" } });
    f.list.mockResolvedValueOnce({ data: [{ name: "d1", id: "x" }], error: null });
    const bad = await handleData(jreq("POST", "data", batch({ appointments: [{ ...appt, deleted: true }] })), deps);
    expect(bad.status).toBe(503);
    expect(await bad.text()).not.toContain("secret detail");
  });

  it("an RLS refusal from the database reads as consent_required, other faults as a plain 503", async () => {
    const { deps, f } = setup();
    f.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "secret" } });
    expect(await code(await handleData(jreq("POST", "data", batch()), deps))).toBe("consent_required");
    f.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret" } });
    const res = await handleData(jreq("POST", "data", batch()), deps);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("secret");
  });
});

describe("documents", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  it("stores a file under owner/appointment/document, replaces it, and hands out a one-minute link", async () => {
    const { deps, f } = setup();
    expect((await handleDoc(req("PUT", "doc?appt=a1&doc=d1", jpeg, { "content-type": "image/jpeg" }), deps)).status).toBe(200);
    expect(f.upload).toHaveBeenCalledWith(`${ME}/a1/d1`, expect.any(Uint8Array), { contentType: "image/jpeg", upsert: true });
    const link = await (await handleDoc(req("GET", "doc?appt=a1&doc=d1"), deps)).json();
    expect(link).toEqual({ url: "https://x.test/sign?t=1", expiresInSec: 60 });
    expect(f.signed).toHaveBeenCalledWith(`${ME}/a1/d1`, 60);
    expect((await handleDoc(req("DELETE", "doc?appt=a1&doc=d1"), deps)).status).toBe(200);
    expect(f.remove).toHaveBeenCalledWith([`${ME}/a1/d1`]);
  });

  it("refuses a bad path, a type that is not allowed, a file that is not what it says, and an empty file", async () => {
    const { deps, f } = setup();
    expect((await handleDoc(req("PUT", "doc?appt=..&doc=d1", jpeg, { "content-type": "image/jpeg" }), deps)).status).toBe(400);
    expect((await handleDoc(req("PUT", "doc?appt=a1&doc=d1", jpeg, { "content-type": "text/html" }), deps)).status).toBe(400);
    expect((await handleDoc(req("PUT", "doc?appt=a1&doc=d1", new TextEncoder().encode("<script>x</script>"), { "content-type": "image/png" }), deps)).status).toBe(400);
    expect((await handleDoc(req("PUT", "doc?appt=a1&doc=d1", new Uint8Array(), { "content-type": "image/jpeg" }), deps)).status).toBe(400);
    expect(f.upload).not.toHaveBeenCalled();
  });

  it("a missing file is a 404, never another person's: the path always starts with the verified user's id", async () => {
    const { deps, f } = setup();
    f.signed.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect((await handleDoc(req("GET", "doc?appt=a1&doc=d1"), deps)).status).toBe(404);
    await handleDoc(req("GET", "doc?appt=a1&doc=d1&owner=someone-else"), deps);
    expect(f.signed.mock.calls.at(-1)?.[0].startsWith(`${ME}/`)).toBe(true);
  });

  it("checks the first bytes against the claimed type", () => {
    expect(matchesType("application/pdf", new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(matchesType("application/pdf", jpeg)).toBe(false);
    expect(matchesType("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(true);
    expect(matchesType("text/plain", new TextEncoder().encode("hello"))).toBe(true);
    expect(matchesType("text/plain", new Uint8Array([0x68, 0, 0x69]))).toBe(false);
    expect(matchesType("image/svg+xml", jpeg)).toBe(false);
  });
});
