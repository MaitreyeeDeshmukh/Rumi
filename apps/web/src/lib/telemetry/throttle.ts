/**
 * A tiny per-instance counter for "at most N per window per key". Used to keep a crash loop from writing a row or a log
 * line per request. Memory is bounded: the oldest keys are forgotten first (maxKeys).
 * `repeats` on an allowed hit is how many hits were refused in the window before; log it so nothing disappears silently.
 */
interface Entry {
  start: number;
  allowed: number;
  refused: number;
}

const MAX_KEYS = 500;
const entries = new Map<string, Entry>();

/** Tests only. */
export function resetThrottle(): void {
  entries.clear();
}

export function hit(key: string, windowMs = 60_000, limit = 1, now: number = Date.now()): { allow: boolean; repeats: number } {
  const e = entries.get(key);
  if (e === undefined || now - e.start >= windowMs) {
    const repeats = e?.refused ?? 0;
    entries.delete(key);
    entries.set(key, { start: now, allowed: 1, refused: 0 });
    while (entries.size > MAX_KEYS) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
    return { allow: true, repeats };
  }
  if (e.allowed < limit) {
    e.allowed++;
    return { allow: true, repeats: 0 };
  }
  e.refused++;
  return { allow: false, repeats: 0 };
}
