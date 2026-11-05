import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { hashingKey } from "@/lib/auth/secret";

/**
 * In-memory sliding windows, per serverless instance. That makes them best effort: a second instance has its own
 * counters. They stop casual floods; the provider spend cap and the daily usage limit are the hard limits.
 *
 * Three windows (07 D20): per hashed client address, per signed session (when a valid cookie was sent) and one
 * global window for the instance. A request without a cookie is counted by address, so cookie-less floods are limited.
 * Requests whose address cannot be read share one bucket with a stricter limit.
 */
export interface Limits {
  perIp: number;
  perSession: number;
  perInstance: number;
  /** Limit for the single shared bucket of requests with no usable address. */
  perUnknownIp: number;
  windowMs: number;
  /** Cap on tracked keys per map. When it is passed, the least recently used keys are removed. */
  maxKeys: number;
}

const DEFAULT_LIMITS: Limits = { perIp: 30, perSession: 20, perInstance: 300, perUnknownIp: 10, windowMs: 60_000, maxKeys: 5000 };

export type LimitResult = { ok: true } | { ok: false; retryAfterSec: number; scope: "ip" | "session" | "instance" };

export interface RateLimiter {
  /** Records the request when it is allowed. A refused request is not recorded. `unknownIp`: the address could not be read. */
  check(ipHash: string, sessionId: string | null, unknownIp?: boolean): LimitResult;
  /** Counts one request against a verified user's own window only (the address and instance windows were counted by `check`). */
  checkUser(userHash: string): LimitResult;
  /** How many addresses and sessions are tracked right now (for the chaos run and tests). Never more than maxKeys each. */
  tracked(): { ips: number; sessions: number };
}

/** IPv6 addresses are counted by their /64 network: a single host owns billions of addresses inside one. */
function normaliseIp(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  let ip = candidate.trim().replace(/^\[|\]$/g, "");
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  const kind = isIP(ip);
  if (kind === 4) return ip;
  if (kind !== 6) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapped && isIP(mapped) === 4) return mapped;
  const [head = "", tail = ""] = ip.split("::");
  const toGroups = (part: string): string[] =>
    part === "" ? [] : part.split(":").flatMap((g) => (g.includes(".") ? ["0", "0"] : [g]));
  const headGroups = toGroups(head);
  const tailGroups = ip.includes("::") ? toGroups(tail) : [];
  const groups = ip.includes("::") ? [...headGroups, ...Array<string>(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill("0"), ...tailGroups] : headGroups;
  return `v6:${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}`;
}

/**
 * The client address, or null when none can be trusted. The forwarding headers are written by the platform in front
 * of the app only on Vercel (the VERCEL variable is set there); anywhere else a client could write them, so they are
 * ignored and every such request shares the one stricter "unknown" bucket.
 * On Vercel the order is: x-vercel-forwarded-for, then x-real-ip (both set by the platform), then the LAST
 * x-forwarded-for entry, which is the one the platform appended. Earlier entries are written by the client and are never used.
 */
export function clientIp(req: Request): string | null {
  if (!process.env.VERCEL) return null;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").pop();
  for (const candidate of [req.headers.get("x-vercel-forwarded-for")?.split(",")[0], req.headers.get("x-real-ip"), forwarded]) {
    const ip = normaliseIp(candidate);
    if (ip) return ip;
  }
  return null;
}

/** Keyed hash, so a leaked counter key cannot be reversed by trying every IPv4 address. 16 hex characters. */
export const hashClientIp = (ip: string): string => createHmac("sha256", hashingKey()).update(`ip:${ip}`).digest("hex").slice(0, 16);

export function createRateLimiter(options: { now?: () => number; limits?: Partial<Limits> } = {}): RateLimiter {
  const now = options.now ?? Date.now;
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  const ips = new Map<string, number[]>();
  const sessions = new Map<string, number[]>();
  let instance: number[] = [];

  const recent = (hits: number[], t: number): number[] => hits.filter((h) => t - h < limits.windowMs);
  const retryAfter = (hits: number[], t: number): number => Math.max(1, Math.ceil((hits[0] + limits.windowMs - t) / 1000));

  /**
   * Read a key's recent hits. An existing key moves to the newest position (Map order is least recently used first);
   * a key that does not exist yet is NOT created here, so refused requests cannot fill the map.
   */
  function peek(map: Map<string, number[]>, key: string, t: number): number[] {
    const existing = map.get(key);
    if (existing === undefined) return [];
    const hits = recent(existing, t);
    map.delete(key);
    map.set(key, hits);
    return hits;
  }
  function record(map: Map<string, number[]>, key: string, t: number, hits: number[]): void {
    hits.push(t);
    map.delete(key);
    map.set(key, hits);
    while (map.size > limits.maxKeys) {
      const oldest = map.keys().next();
      if (oldest.done) return;
      map.delete(oldest.value);
    }
  }

  return {
    check(ipHash, sessionId, unknownIp = false) {
      const t = now();
      const ipHits = peek(ips, ipHash, t);
      const sessionHits = sessionId === null ? [] : peek(sessions, sessionId, t);
      instance = recent(instance, t);

      if (ipHits.length >= (unknownIp ? limits.perUnknownIp : limits.perIp)) return { ok: false, retryAfterSec: retryAfter(ipHits, t), scope: "ip" };
      if (sessionId !== null && sessionHits.length >= limits.perSession) {
        return { ok: false, retryAfterSec: retryAfter(sessionHits, t), scope: "session" };
      }
      if (instance.length >= limits.perInstance) return { ok: false, retryAfterSec: retryAfter(instance, t), scope: "instance" };

      record(ips, ipHash, t, ipHits);
      if (sessionId !== null) record(sessions, sessionId, t, sessionHits);
      instance.push(t);
      return { ok: true };
    },
    checkUser(userHash) {
      const t = now();
      const hits = peek(sessions, userHash, t);
      if (hits.length >= limits.perSession) return { ok: false, retryAfterSec: retryAfter(hits, t), scope: "session" };
      record(sessions, userHash, t, hits);
      return { ok: true };
    },
    tracked: () => ({ ips: ips.size, sessions: sessions.size }),
  };
}

/** The limiter every route in this instance shares. */
export const rateLimiter: RateLimiter = createRateLimiter();
