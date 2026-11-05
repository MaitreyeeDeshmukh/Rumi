/**
 * SERVER ONLY. Verified erasure of one namespace: list every page, delete in batches of 100, then list again.
 * It says `ok` only after TWO consecutive empty lists; a document that comes back resets the count.
 * Anything else after the time budget is `failed`, and the browser then keeps the recovery code so the
 * person can try again. Delete and list errors are retried inside the budget, never treated as success.
 */
import { createNamespaceQueue, type NamespaceQueue } from './remoteSync';
import { NS_RE, type SmClient } from './smClient';

export type ForgetResult = 'ok' | 'failed';

export interface ForgetDeps {
  client: SmClient;
  /** Same queue as the sync code, so an in-flight sync cannot write after the erase. */
  queue?: NamespaceQueue;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxMs?: number;
  intervalMs?: number;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const NEEDED_EMPTY_LISTS = 2;

export function forgetNamespace(ns: string, deps: ForgetDeps): Promise<ForgetResult> {
  const { client, queue = createNamespaceQueue(), sleep = realSleep, now = Date.now, maxMs = 10_000, intervalMs = 1000 } = deps;
  if (!NS_RE.test(ns)) return Promise.resolve('failed');
  return queue(ns, async (): Promise<ForgetResult> => {
    const deadline = now() + maxMs;
    let emptyLists = 0;
    for (;;) {
      try {
        const ids = (await client.listAll(ns)).map((d) => d.id);
        if (ids.length === 0) {
          emptyLists++;
          if (emptyLists >= NEEDED_EMPTY_LISTS) return 'ok';
        } else {
          emptyLists = 0;
          await client.del(ns, ids);
        }
      } catch {
        emptyLists = 0; // an error proves nothing; try again until the budget ends
      }
      if (now() >= deadline) return 'failed';
      await sleep(intervalMs);
    }
  });
}
