/**
 * Verified erasure of one namespace (server side; the browser never imports this, a test proves it).
 *
 * A document that was just written is not listed until Supermemory has indexed it ("queued"). A list that is
 * empty too early proves nothing. So the erase:
 *  1. waits `settleMs` before the first list (longer if a sync was very recent, see `sinceSyncMs`);
 *  2. lists every page, deletes what it finds in batches of 100, and lists again;
 *  3. says `ok` only after `emptyStreak` consecutive empty lists, each at least `intervalMs` after the previous;
 *     a document that shows up resets the count;
 *  4. returns `failed` if it cannot finish inside `maxMs`. Every request is capped by the time that is left, so
 *     nothing runs past the deadline. Delete and list errors are retried inside the budget and never read as success;
 *     a 429 backs off (doubling) instead of hammering.
 * `lagMs`, `settleMs` and `emptyStreak` are the knobs for the measured indexing lag (Phase 4 spike). The defaults
 * are an assumption: they only prove what they cover. Two instances cannot be serialised; a sync that starts on
 * another instance after the last empty list can still leave a document behind (documented limit).
 */
import type { NamespaceQueue } from './remoteSync';
import { NS_RE, SmError, type SmClient } from './smClient';

export type ForgetResult = 'ok' | 'failed';

export interface ForgetDeps {
  client: SmClient;
  /** Required, and the same instance the sync code uses, so an in-flight sync finishes before the erase starts. */
  queue: NamespaceQueue;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Whole-job budget. Default 20 s. */
  maxMs?: number;
  /** Wait before the first list. Default 4 s. */
  settleMs?: number;
  /** Longest listing lag we assume. The first list happens at least this long after the last known write. Default 5 s. */
  lagMs?: number;
  /** Consecutive empty lists needed. Default 3. */
  emptyStreak?: number;
  /** Minimum gap between lists. Default 1.5 s. */
  intervalMs?: number;
  /** How long ago the browser last synced, in ms (browser clock, so no clock skew). Best effort; only lengthens the wait. */
  sinceSyncMs?: number;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_BACKOFF_MS = 8000;

export function forgetNamespace(ns: string, deps: ForgetDeps): Promise<ForgetResult> {
  const {
    client,
    queue,
    sleep = realSleep,
    now = Date.now,
    maxMs = 20_000,
    settleMs = 4000,
    lagMs = 5000,
    emptyStreak = 3,
    intervalMs = 1500,
  } = deps;
  if (!NS_RE.test(ns)) return Promise.resolve('failed');
  // A bad value must not shorten the wait: negative, NaN or missing counts as "long ago".
  const since = deps.sinceSyncMs !== undefined && Number.isFinite(deps.sinceSyncMs) && deps.sinceSyncMs >= 0 ? deps.sinceSyncMs : Number.POSITIVE_INFINITY;

  return queue(ns, async (): Promise<ForgetResult> => {
    const deadline = now() + maxMs;
    const budget = (): number => deadline - now();
    const firstWait = Math.max(settleMs, lagMs - since);
    if (firstWait >= budget()) return 'failed'; // cannot both wait and verify inside the budget
    await sleep(firstWait);

    let empties = 0;
    let backoff = intervalMs;
    for (;;) {
      if (budget() <= 0) return 'failed';
      try {
        const ids = (await client.listAll(ns, budget)).map((d) => d.id);
        backoff = intervalMs;
        if (ids.length === 0) {
          empties++;
          if (empties >= emptyStreak) return 'ok';
        } else {
          empties = 0;
          await client.del(ns, ids, budget); // refused ids simply show up in the next list
        }
      } catch (e) {
        empties = 0; // an error proves nothing; try again until the budget ends
        if (e instanceof SmError && e.status === 429) backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
      const left = budget();
      if (left <= 0) return 'failed';
      await sleep(Math.min(backoff, left));
    }
  });
}
