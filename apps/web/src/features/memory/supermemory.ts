/**
 * Supermemory as the SEMANTIC RECALL layer over the persona facts. Server only (holds the key).
 * The Supabase persona_facts table stays the record the person sees, edits and erases. This file:
 *  - mirrors each consented fact to Supermemory under the person's own container tag (see tag.ts);
 *  - recalls the facts that fit a task, for the STYLE region of a prompt;
 *  - erases the person's documents and PROVES it (list, delete, list again).
 * Every function fails open: no key, flag off, no consent, a timeout or any error means "do nothing / no memory",
 * never an exception. Nothing here logs: callers get a fixed status code. Text from Supermemory is NEVER used: a hit
 * is read only for its (kind, key, level) metadata, checked by the same schema as the routes, and the sentence is
 * rebuilt from the fixed tables in factText.ts. So a poisoned stored line cannot reach a prompt. help_level never does (07 D25).
 */
import { getSupermemoryConfig, memoryEnabled } from '@/lib/env';
import { PersonaFactWire, type PersonaFactRemovalT, type PersonaFactSyncT } from '@/features/shared/schemas';
import { factStrings, factText } from './factText';
import { createSmClient, type SmClient } from './smClient';
import { tagForUser } from './tag';

export interface SmCtx {
  client: SmClient;
  tag: string;
}
export interface SmOpts {
  /** Tests inject this. Default: built from the environment (null when off). */
  ctx?: SmCtx | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}
export type SmStatus = 'off' | 'ok' | 'failed';

const RECALL_TIMEOUT_MS = 1500;
const RECALL_MAX = 6;
/** Asked for more than RECALL_MAX because help_level hits are dropped afterwards. */
const RECALL_ASK = 10;
const MIRROR_MAX = 20;

/** `use`: needs MEMORY_ENABLED. `erase`: needs only the key and secret, so an erase works after the switch is turned off. */
function ctxFrom(userId: string, mode: 'use' | 'erase'): SmCtx | null {
  try {
    const cfg = getSupermemoryConfig();
    if (!cfg || (mode === 'use' && !memoryEnabled())) return null;
    return { client: createSmClient({ fetchFn: (i, init) => fetch(i, init), apiKey: cfg.apiKey }), tag: tagForUser(userId, cfg.tagSecret) };
  } catch {
    return null;
  }
}
const resolve = (userId: string, o: SmOpts | undefined, mode: 'use' | 'erase'): SmCtx | null => (o && 'ctx' in o ? (o.ctx ?? null) : ctxFrom(userId, mode));
const docId = (kind: string, key: string): string => `${kind}_${key}`;

/** Copies saved facts (and removals) to Supermemory. Call only after consent was checked. Never throws. */
export async function mirrorFacts(userId: string, facts: readonly PersonaFactSyncT[], removed: readonly PersonaFactRemovalT[], o?: SmOpts): Promise<SmStatus> {
  const ctx = resolve(userId, o, 'use');
  if (!ctx) return 'off';
  try {
    // ponytail: re-adds every fact on every sync (at most a dozen, same customId = update). Diff against a list if volume grows.
    await Promise.all(
      facts.slice(0, MIRROR_MAX).flatMap((f) => {
        const content = factText(f.kind, f.key, f.level);
        if (content === null) return [];
        return [ctx.client.add(ctx.tag, { customId: docId(f.kind, f.key), content, metadata: { kind: f.kind, key: f.key, ...(f.level === undefined ? {} : { level: f.level }) } })];
      }),
    );
    if (removed.length > 0) {
      const gone = new Set(removed.map((r) => docId(r.kind, r.key)));
      const ids = (await ctx.client.listAll(ctx.tag)).filter((d) => d.customId !== undefined && gone.has(d.customId)).map((d) => d.id);
      if (ids.length > 0 && (await ctx.client.del(ids)).length > 0) return 'failed';
    }
    return 'ok';
  } catch {
    return 'failed';
  }
}

const VOCAB = /^[a-z_]{1,30}$/;
const word = (v: unknown): string | undefined => (typeof v === 'string' && VOCAB.test(v) ? v.replace(/_/g, ' ') : undefined);

/** A query from fixed vocabulary only (item kinds, focus, scenario). Nothing the person typed is sent to Supermemory. */
export function recallQuery(task: string, body: unknown): string {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const kinds = new Set<string>();
  const items = (b.plan as { items?: unknown } | undefined)?.items;
  if (Array.isArray(items)) for (const it of items.slice(0, 12)) { const k = word((it as { kind?: unknown } | null)?.kind); if (k) kinds.add(k); }
  const parts = [task, ...kinds, word(b.focus), word(b.scenario)].filter((x): x is string => !!x);
  return `How this person likes to be supported and paced during: ${parts.join(', ')}`;
}

/** Sentences for the STYLE region. Empty on any problem. Total time is capped at 1.5 s. */
export async function recallForTask(
  a: { userId: string; task: string; queryText: string; hasConsent: () => Promise<boolean> },
  o?: SmOpts,
): Promise<string[]> {
  const ctx = resolve(a.userId, o, 'use');
  if (!ctx) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async (): Promise<string[]> => {
      if (!(await a.hasConsent())) return [];
      const hits = await ctx.client.search(ctx.tag, a.queryText, RECALL_ASK, RECALL_TIMEOUT_MS);
      const facts = hits.flatMap((m) => {
        const p = PersonaFactWire.safeParse({ kind: m.kind, key: m.key, ...(m.level === undefined ? {} : { level: m.level }) });
        return p.success && p.data.kind !== 'help_level' ? [p.data] : [];
      });
      return factStrings(facts).slice(0, RECALL_MAX);
    })();
    const late = new Promise<string[]>((r) => (timer = setTimeout(() => r([]), RECALL_TIMEOUT_MS)));
    return await Promise.race([work.catch(() => []), late]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deletes every document of the person and proves it: list, delete, list again, until two lists in a row are empty
 * or `maxMs` runs out. 'failed' means something may remain. 'off' means Supermemory is not configured (nothing was ever sent).
 */
export async function eraseRemote(userId: string, o?: SmOpts & { maxMs?: number; gapMs?: number }): Promise<SmStatus> {
  const ctx = resolve(userId, o, 'erase');
  if (!ctx) return 'off';
  const sleep = o?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o?.now ?? (() => performance.now());
  const deadline = now() + (o?.maxMs ?? 12_000);
  const gap = o?.gapMs ?? 1000;
  let empties = 0;
  while (now() < deadline) {
    try {
      const ids = (await ctx.client.listAll(ctx.tag, Math.max(1, deadline - now()))).map((d) => d.id);
      if (ids.length === 0) {
        if (++empties >= 2) return 'ok';
      } else {
        empties = 0;
        await ctx.client.del(ids, Math.max(1, deadline - now())); // refused ids show up in the next list
      }
    } catch {
      empties = 0; // an error proves nothing
    }
    await sleep(gap);
  }
  return 'failed';
}
