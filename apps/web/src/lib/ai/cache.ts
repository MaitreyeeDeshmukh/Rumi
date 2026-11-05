/**
 * Caching policy (08 section 5), per serverless instance, in memory:
 *  - singleFlight: identical requests that are in flight at the same time share one computation (retry storms, double submit).
 *  - replyCache: per user, 60 s, 500 entries, least recently used out first. Only validated replies are put in.
 *  - sharedCache: 24 h, for replies that contain no user text at all (see sharedCacheKey). Never the reply cache's job.
 * Keys are HMACs, so no key holds a user id, an address or any text. A hit is served; a miss never changes behaviour.
 */
import { createHmac, createHash } from "node:crypto";
import type { TaskName } from "@/features/shared/task";
import { hashingKey } from "@/lib/auth/secret";

const inFlight = new Map<string, Promise<unknown>>();

/** Runs `fn` once per key at a time. Callers that arrive while it runs get the same result, or the same rejection. */
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key);
  if (running !== undefined) return running as Promise<T>;
  const p = fn().finally(() => {
    if (inFlight.get(key) === p) inFlight.delete(key);
  });
  inFlight.set(key, p);
  return p;
}

export interface TtlCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  size(): number;
  clear(): void;
}

/** Map order is oldest first: a read moves the key to the end, a write past `max` removes from the front. */
export function createTtlCache<V>(options: { ttlMs: number; max: number; now?: () => number }): TtlCache<V> {
  const now = options.now ?? Date.now;
  const map = new Map<string, { value: V; expires: number }>();
  return {
    get(key) {
      const hit = map.get(key);
      if (hit === undefined) return undefined;
      map.delete(key);
      if (hit.expires <= now()) return undefined;
      map.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { value, expires: now() + options.ttlMs });
      while (map.size > options.max) {
        const oldest = map.keys().next();
        if (oldest.done) return;
        map.delete(oldest.value);
      }
    },
    size: () => map.size,
    clear: () => map.clear(),
  };
}

const REPLY_TTL_MS = 60_000;
const REPLY_MAX = 500;
const SHARED_TTL_MS = 24 * 3_600_000;
const SHARED_MAX = 500;

export const replyCache: TtlCache<unknown> = createTtlCache({ ttlMs: REPLY_TTL_MS, max: REPLY_MAX });
export const sharedCache: TtlCache<unknown> = createTtlCache({ ttlMs: SHARED_TTL_MS, max: SHARED_MAX });

/** HMAC-SHA256 over the parts, hex. The parts are joined with a character none of them can contain. */
export const cacheKey = (parts: readonly string[]): string => createHmac("sha256", hashingKey()).update(parts.join("\u0000")).digest("hex");

/** Stable JSON: object keys sorted, so the same request in another key order has the same digest. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export const requestDigest = (body: unknown): string => createHash("sha256").update(canonical(body)).digest("hex");

/**
 * Per-user reply key: HMAC(userHash | task | sha256(canonical request) | promptVersion | model).
 * `body` is the whole parsed body, memory facts included, so a different preference never shares an answer.
 */
export const replyKey = (userHash: string, task: TaskName, body: unknown, promptVersion: string, model: string): string =>
  cacheKey([userHash, task, requestDigest(body), promptVersion, model]);

/** The helper name every shared reply is generated with. A request with any other name never uses the shared cache. */
export const CANONICAL_COMPANION = "Rumi";

/**
 * The shared key, or null when the reply is not user-independent. Only a say-it scenario at level 2 or 3 qualifies, and
 * only when the request carries no user text (no concern, no symptoms, no clinician question), no stated preferences
 * are in the prompt, and the helper name is the canonical one (that name is written into the system prompt, so it is
 * attacker-controlled text: a shared reply must have been made with the constant). The key is
 * `sayit|<digest of the whole sanitized request>|promptVersion|model`, so no field can be forgotten. Bump the prompt version to invalidate.
 */
export function sharedCacheKey(task: TaskName, r: unknown, memoryItems: number, promptVersion: string, model: string): string | null {
  if (task !== "sayit" || memoryItems > 0 || typeof r !== "object" || r === null) return null;
  const q = r as { scenario?: unknown; level?: unknown; clinicianQuestion?: unknown; mainConcern?: unknown; symptomsInMyWords?: unknown; companionName?: unknown };
  const hasText = (typeof q.mainConcern === "string" && q.mainConcern.trim() !== "") || (Array.isArray(q.symptomsInMyWords) && q.symptomsInMyWords.length > 0);
  if (typeof q.scenario !== "string" || q.clinicianQuestion !== undefined || hasText || (q.level !== 2 && q.level !== 3)) return null;
  if (q.companionName !== CANONICAL_COMPANION) return null;
  return `sayit|${requestDigest(r)}|${promptVersion}|${model}`;
}
