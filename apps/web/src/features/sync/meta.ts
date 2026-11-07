/**
 * The sync marks, kept in their own localStorage key (not in the app state, so the state schema stays as it is).
 * Reading never throws; anything unreadable gives an empty mark set, which makes the next sync treat every record as new.
 */
import { z } from 'zod';
import { emptyMeta, type SyncMeta } from './merge';

export const META_KEY = 'rumi.sync.v1';
const MAX_RECORDS = 5000;

export type MetaStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const Record_ = z.object({ h: z.string().max(40), u: z.number().finite(), s: z.boolean(), del: z.boolean().optional(), p: z.string().max(40).optional() });
const Stored = z.object({ v: z.literal(1), userId: z.string().max(80), on: z.boolean(), records: z.record(z.string().max(60), Record_) });

export function loadMeta(storage: MetaStorage | null): SyncMeta {
  try {
    const raw = storage?.getItem(META_KEY);
    if (!raw) return emptyMeta();
    const parsed = Stored.safeParse(JSON.parse(raw));
    if (!parsed.success || Object.keys(parsed.data.records).length > MAX_RECORDS) return emptyMeta();
    return parsed.data;
  } catch {
    return emptyMeta();
  }
}

/** Returns false when the browser refused (full or blocked). The engine keeps its copy in memory either way. */
export function saveMeta(storage: MetaStorage | null, meta: SyncMeta): boolean {
  try {
    storage?.setItem(META_KEY, JSON.stringify(meta));
    return storage != null;
  } catch {
    return false;
  }
}

export function clearMeta(storage: MetaStorage | null): void {
  try {
    storage?.removeItem(META_KEY);
  } catch {
    // blocked storage: nothing to clear
  }
}
