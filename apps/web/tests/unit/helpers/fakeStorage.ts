import type { StorageLike } from "@/lib/storage";

export interface FakeStorage extends StorageLike {
  data: Map<string, string>;
  failWrites?: Error | null;
  writes: number;
}

/** In-memory stand-in for localStorage. `failWrites` makes setItem throw (quota, blocked). */
export function fakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const data = new Map(Object.entries(initial));
  const s: FakeStorage = {
    data,
    failWrites: null,
    writes: 0,
    getItem: (k) => data.get(k) ?? null,
    setItem(k, v) {
      if (s.failWrites) throw s.failWrites;
      s.writes++;
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };
  return s;
}
