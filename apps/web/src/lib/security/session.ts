import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { ConfigError, getSessionSecret, isProduction } from "@/lib/env";

/** Used only outside production, so local work and tests need no secret. Never used when NODE_ENV is production. */
const DEV_SECRET = "rumi-dev-only-secret-never-used-in-production";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COOKIE_RE = /(?:^|;\s*)rumi_sid=([^;]+)/;
const MAX_AGE_SEC = 86_400;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Key for session signatures. Outside production a fixed development secret is used when none is set.
 * In production a missing or too short SESSION_SECRET throws ConfigError, even with MOCK_AI=1.
 */
export function signingSecret(): string {
  const secret = getSessionSecret();
  if (secret) return secret;
  if (!isProduction()) return DEV_SECRET;
  throw new ConfigError(["SESSION_SECRET"]);
}

let processKey: string | undefined;

/**
 * Key for hashing client addresses. Same as the signing secret when there is one; otherwise a random key made once
 * per process, so the in-memory limiter keeps working with no configuration and no address hash is guessable.
 */
export function hashingKey(): string {
  try {
    return signingSecret();
  } catch {
    // No usable secret: the hash only has to be stable inside this process.
    processKey ??= randomBytes(32).toString("hex");
    return processKey;
  }
}

const sign = (secret: string, payload: string): string => createHmac("sha256", secret).update(payload).digest("base64url");

/** Constant-time comparison. timingSafeEqual throws on different lengths, so the length check comes first. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface Session {
  /** null when no signing secret is usable: the request is counted by address only. */
  id: string | null;
  setCookie: string | null;
}

/**
 * Anonymous signed session id, used for rate limiting only (never for memory or any stored data).
 * The cookie is `id.issuedAt.signature`; the issue time is signed too, and a cookie older than 24 hours is ignored.
 * A forged, malformed, unsigned or expired cookie is ignored and a fresh id is issued. With no usable secret
 * there is no session at all (id null), so a configuration problem never turns into a failed request.
 * `Secure` is dropped only for plain-http localhost.
 */
export function getSession(req: Request, now: number = Date.now()): Session {
  let secret: string;
  try {
    secret = signingSecret();
  } catch {
    // Misconfigured secret: degrade to an address-only limit instead of failing the request.
    return { id: null, setCookie: null };
  }
  const nowSec = Math.floor(now / 1000);
  const raw = COOKIE_RE.exec(req.headers.get("cookie") ?? "")?.[1];
  if (raw) {
    const [id, issued, sig, extra] = raw.split(".");
    if (id && issued && sig && extra === undefined && UUID_RE.test(id) && /^\d{1,12}$/.test(issued)) {
      const age = nowSec - Number(issued);
      if (age >= -60 && age <= MAX_AGE_SEC && safeEqual(sig, sign(secret, `${id}.${issued}`))) return { id, setCookie: null };
    }
  }
  const id = randomUUID();
  const url = new URL(req.url);
  const secure = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname) ? "" : " Secure;";
  const value = `${id}.${nowSec}.${sign(secret, `${id}.${nowSec}`)}`;
  return { id, setCookie: `rumi_sid=${value}; Path=/api; HttpOnly;${secure} SameSite=Strict; Max-Age=${MAX_AGE_SEC}` };
}
