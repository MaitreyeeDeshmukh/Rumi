/**
 * What travels between a device and the sync routes. One shape for both sides: the browser builds it, the route checks
 * it again with the same schemas, and the database function stores it. Nothing here knows about React or Supabase.
 * `updated_at` is the time the PERSON changed the record on a device; last write wins on it.
 */
import { z } from 'zod';
import { ID_RE } from '@/features/shared/constants';
import { parseState } from '@/lib/storage-schema';
import type { Appointment, ChatMessage, ChatThread } from '@/features/shared/types';

const Id = z.string().regex(ID_RE);
const Time = z.iso.datetime({ offset: true });

export const SYNC_LIMITS = { appointments: 100, documents: 500, chats: 100, messages: 200, bodyBytes: 40_000, batchBytes: 400_000, requestBytes: 1_000_000 } as const;

export const WireAppointment = z.strictObject({
  id: Id,
  /** The appointment without its documents. The server stores only what the app's own reader keeps. */
  body: z.record(z.string(), z.unknown()),
  created_at: Time,
  updated_at: Time,
  deleted: z.boolean(),
});

export const WireDocument = z.strictObject({
  id: Id,
  appt_id: Id,
  kind: z.enum(['text', 'image', 'pdf']),
  name: z.string().max(120),
  excerpt: z.string().max(4000),
  confirmed: z.boolean(),
  created_at: Time,
  updated_at: Time,
  deleted: z.boolean(),
});

export const WireChat = z.strictObject({
  id: Id,
  kind: z.enum(['get-ready', 'practice']),
  appt_id: Id.nullish(),
  created_at: Time,
  updated_at: Time,
  deleted: z.boolean(),
  messages: z.array(z.strictObject({ role: z.enum(['me', 'rumi']), text: z.string().min(1).max(1200) })).max(SYNC_LIMITS.messages),
});

export const PushBatch = z.strictObject({
  appointments: z.array(WireAppointment).max(SYNC_LIMITS.appointments),
  documents: z.array(WireDocument).max(SYNC_LIMITS.documents),
  chats: z.array(WireChat).max(SYNC_LIMITS.chats),
});
export const PullReply = z.object({ appointments: z.array(z.unknown()), documents: z.array(z.unknown()), chats: z.array(z.unknown()) });

export type WireAppointmentT = z.infer<typeof WireAppointment>;
export type WireDocumentT = z.infer<typeof WireDocument>;
export type WireChatT = z.infer<typeof WireChat>;
export type PushBatchT = z.infer<typeof PushBatch>;
/** A pull answer after each record has been checked on its own: a record that fails is left out, never trusted. */
export interface Remote {
  appointments: WireAppointmentT[];
  documents: WireDocumentT[];
  chats: WireChatT[];
  /** Keys (a:id, d:id, c:id) of records the server sent that this app could not read. They must not count as "gone". */
  unreadable: string[];
}

export const emptyBatch = (): PushBatchT => ({ appointments: [], documents: [], chats: [] });
export const batchSize = (b: PushBatchT): number => b.appointments.length + b.documents.length + b.chats.length;

/** Checks a pull answer record by record. A record that is not the agreed shape is left out and its key is listed as unreadable. */
export function parseRemote(raw: unknown): Remote | null {
  const top = PullReply.safeParse(raw);
  if (!top.success) return null;
  const unreadable: string[] = [];
  const keep = <T>(prefix: string, schema: z.ZodType<T>, list: unknown[]): T[] =>
    list.flatMap((x) => {
      const r = schema.safeParse(x);
      if (r.success) return [r.data];
      const id = (x as { id?: unknown } | null)?.id;
      if (typeof id === 'string') unreadable.push(`${prefix}:${id}`);
      return [];
    });
  return {
    appointments: keep('a', WireAppointment, top.data.appointments),
    documents: keep('d', WireDocument, top.data.documents),
    chats: keep('c', WireChat, top.data.chats),
    unreadable,
  };
}

/**
 * The appointment body the server may store: whatever the app's own reader keeps of it. Unknown fields are removed and
 * text is cut to the same limits. Null when it is not a valid appointment (or does not match the id), or is over the size limit.
 */
export function cleanBody(id: string, body: Record<string, unknown>): Appointment | null {
  const a = parseState({ version: 1, appointments: [{ ...body, id }] }).appointments?.[0];
  if (!a || a.id !== id) return null;
  const rest = { ...a };
  delete rest.documents;
  return JSON.stringify(rest).length <= SYNC_LIMITS.bodyBytes ? rest : null;
}

/** A chat as the app's own reader keeps it. Null when nothing valid is left. */
export function cleanChat(c: WireChatT): ChatThread | null {
  const messages: ChatMessage[] = c.messages;
  const t = parseState({ version: 1, chats: [{ id: c.id, kind: c.kind, apptId: c.appt_id ?? undefined, createdAt: c.created_at, updatedAt: c.updated_at, messages }] }).chats?.[0];
  return t ?? null;
}
