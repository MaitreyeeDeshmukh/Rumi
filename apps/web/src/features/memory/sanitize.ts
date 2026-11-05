/**
 * The one door every fact passes through, in the browser before sending, in the route before writing, in the store
 * before the database call and on the way back out. A bad or oversized batch is refused, never trimmed to fit.
 */
import { FACTS_BATCH_MAX } from '@/features/shared/constants';
import { FactsRequest, PersonaFactSync, type PersonaFactRemovalT } from '@/features/shared/schemas';
import type { StoredFact } from './types';

export type BatchResult =
  | { ok: true; facts: StoredFact[]; removed: PersonaFactRemovalT[] }
  | { ok: false; reason: 'too_many' | 'invalid' };

/** A change stamp before this or more than five minutes ahead is not a real device clock; it could pin a fact forever. */
const EARLIEST_MS = Date.UTC(2020, 0, 1);
const FUTURE_SLACK_MS = 5 * 60_000;

const sizeOf = (o: unknown, key: string): number => {
  const v = typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[key] : undefined;
  return Array.isArray(v) ? v.length : 0;
};

/** Checks an untrusted write (the body a browser sends). */
export function parseFactBatch(raw: unknown, nowMs: number = Date.now()): BatchResult {
  if (sizeOf(raw, 'facts') > FACTS_BATCH_MAX || sizeOf(raw, 'removed') > FACTS_BATCH_MAX) return { ok: false, reason: 'too_many' };
  const parsed = FactsRequest.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  const removed = parsed.data.removed ?? [];
  const stamps = [...parsed.data.facts, ...removed].map((f) => Date.parse(f.client_updated_at));
  if (stamps.some((t) => Number.isNaN(t) || t < EARLIEST_MS || t > nowMs + FUTURE_SLACK_MS)) return { ok: false, reason: 'invalid' };
  return { ok: true, facts: parsed.data.facts, removed };
}

/** PostgREST sends timestamptz as "2026-11-05T10:00:00.123456+00:00"; the schema wants one ISO form. */
function isoOf(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** Checks rows read back from the database. A bad row is dropped and counted; it never reaches a prompt or a screen. */
export function cleanRows(rows: readonly unknown[]): { facts: StoredFact[]; rejected: number } {
  const facts: StoredFact[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const row of rows) {
    try {
      const r = row as { kind?: unknown; key?: unknown; level?: unknown; client_updated_at?: unknown };
      const parsed = PersonaFactSync.safeParse({
        kind: r.kind,
        key: r.key,
        ...(r.level === null || r.level === undefined ? {} : { level: r.level }),
        client_updated_at: isoOf(r.client_updated_at),
      });
      const id = parsed.success ? `${parsed.data.kind}:${parsed.data.key}` : '';
      if (!parsed.success || seen.has(id)) {
        rejected++;
        continue;
      }
      seen.add(id);
      facts.push(parsed.data);
    } catch {
      // A row whose fields throw when read (a hostile getter) is a bad row like any other.
      rejected++;
    }
  }
  return { facts, rejected };
}
