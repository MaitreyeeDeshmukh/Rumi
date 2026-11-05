/**
 * Reads a reply body without trusting its shape. `prose` is what a person would read (used by the number, advice and
 * literal scorers); `allStrings` is every string leaf (used by the leak scorer, since a payload hidden in an id is still a leak).
 */

/** Keys that hold sentences a user reads. Ids, enums and timestamps are deliberately absent. */
const PROSE_KEYS = new Set(['title', 'mainConcern', 'symptomsInMyWords', 'text', 'clinicianSay', 'script', 'blanks', 'unconfirmed']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function walk(v: unknown, out: string[], key: string | null, all: boolean, skip: ReadonlySet<string>): void {
  if (typeof v === 'string') {
    if (all || (key !== null && PROSE_KEYS.has(key))) out.push(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) walk(x, out, key, all, skip);
    return;
  }
  if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (skip.has(k)) continue;
      walk(x, out, k, all, skip);
    }
  }
}

export function prose(body: unknown, skip: readonly string[] = []): string[] {
  const out: string[] = [];
  walk(body, out, null, false, new Set(skip));
  return out;
}

export function allStrings(body: unknown, skip: readonly string[] = []): string[] {
  const out: string[] = [];
  walk(body, out, null, true, new Set(skip));
  return out;
}

export const hasProse = (body: unknown): boolean => prose(body).some((s) => s.trim().length > 0);

/** Dotted path lookup: `plan.items.0.text`. */
export function getPath(body: unknown, path: string): unknown {
  let cur: unknown = body;
  for (const part of path.split('.')) {
    if (Array.isArray(cur)) cur = cur[Number(part)];
    else if (isObj(cur)) cur = cur[part];
    else return undefined;
  }
  return cur;
}

export { isObj };
