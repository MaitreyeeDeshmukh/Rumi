import { createHmac } from "node:crypto";
import { signingSecret } from "./session";

/**
 * In-memory sliding windows, per serverless instance. That makes them best effort: a second instance has its own
 * counters. They stop casual floods; the provider spend cap and the daily usage limit are the hard limits.
 *
 * Three windows (07 D20): per hashed client address, per signed session (when a valid cookie was sent) and one
 * global window for the instance. A request without a cookie is counted by address, so cookie-less floods are limited.
 */
export interface Limits {
  perIp: number;
  perSession: number;
  perInstance: number;
  windowMs: number;
  /** Cap on tracked keys per map. When it is passed, the least recently used keys are removed. */
  maxKeys: number;
}

const DEFAULT_LIMITS: Limits = { perIp: 30, perSession: 20, perInstance: 300, windowMs: 60_000, maxKeys: 5000 };

export type LimitResult = { ok: true } | { ok: false; retryAfterSec: number; scope: "ip" | "session" | "instance" };

export interface RateLimiter {
  /** Records the request when it is allowed. A refused request is not recorded. */
  check(ipHash: string, sessionId: string | null): LimitResult;
}

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

/** x-real-ip first (set by the platform), else the first x-forwarded-for entry. Junk values are ignored. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0];
  for (const candidate of [req.headers.get("x-real-ip"), forwarded]) {
    const ip = candidate?.trim();
    if (ip && IP_RE.test(ip)) return ip;
  }
  return "unknown";
}

/** Keyed hash, so a leaked counter key cannot be reversed by trying every IPv4 address. 16 hex characters. */
export const hashClientIp = (ip: string): string => createHmac("sha256", signingSecret()).update(`ip:${ip}`).digest("hex").slice(0, 16);

export function createRateLimiter(options: { now?: () => number; limits?: Partial<Limits> } = {}): RateLimiter {
  const now = options.now ?? Date.now;
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  const ips = new Map<string, number[]>();
  const sessions = new Map<string, number[]>();
  let instance: number[] = [];

  const recent = (hits: number[], t: number): number[] => hits.filter((h) => t - h < limits.windowMs);
  const retryAfter = (hits: number[], t: number): number => Math.max(1, Math.ceil((hits[0] + limits.windowMs - t) / 1000));

  /** Read a key and move it to the newest position, so Map order is least recently used first. */
  function touch(map: Map<string, number[]>, key: string, t: number): number[] {
    const hits = recent(map.get(key) ?? [], t);
    map.delete(key);
    map.set(key, hits);
    return hits;
  }
  function evict(map: Map<string, number[]>): void {
    while (map.size > limits.maxKeys) {
      const oldest = map.keys().next();
      if (oldest.done) return;
      map.delete(oldest.value);
    }
  }

  return {
    check(ipHash, sessionId) {
      const t = now();
      const ipHits = touch(ips, ipHash, t);
      const sessionHits = sessionId === null ? [] : touch(sessions, sessionId, t);
      instance = recent(instance, t);
      evict(ips);
      evict(sessions);

      if (ipHits.length >= limits.perIp) return { ok: false, retryAfterSec: retryAfter(ipHits, t), scope: "ip" };
      if (sessionId !== null && sessionHits.length >= limits.perSession) {
        return { ok: false, retryAfterSec: retryAfter(sessionHits, t), scope: "session" };
      }
      if (instance.length >= limits.perInstance) return { ok: false, retryAfterSec: retryAfter(instance, t), scope: "instance" };

      ipHits.push(t);
      if (sessionId !== null) sessionHits.push(t);
      instance.push(t);
      return { ok: true };
    },
  };
}

/** The limiter every route in this instance shares. */
export const rateLimiter: RateLimiter = createRateLimiter();
