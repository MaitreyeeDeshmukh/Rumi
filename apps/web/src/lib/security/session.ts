import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/** Used only outside production, or with MOCK_AI=1, so local work and tests need no secret. */
const DEV_SECRET = "rumi-dev-only-secret-never-used-in-production";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COOKIE_RE = /(?:^|;\s*)rumi_sid=([^;]+)/;

/** Key for session signatures and for hashing client addresses. Throws only in production with no secret and no MOCK_AI. */
export function signingSecret(): string {
  const env = getEnv();
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (env.MOCK_AI === "1" || env.NODE_ENV !== "production") return DEV_SECRET;
  throw new Error("SESSION_SECRET missing");
}

const sign = (id: string): string => createHmac("sha256", signingSecret()).update(id).digest("base64url");

/** Constant-time comparison. timingSafeEqual throws on different lengths, so the length check comes first. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Anonymous signed session id, used for rate limiting only (never for memory or any stored data).
 * A forged, malformed or unsigned cookie is ignored and a fresh id is issued.
 */
export function getSession(req: Request): { id: string; setCookie: string | null } {
  const raw = COOKIE_RE.exec(req.headers.get("cookie") ?? "")?.[1];
  if (raw) {
    const dot = raw.indexOf(".");
    const id = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    if (dot > 0 && UUID_RE.test(id) && safeEqual(sig, sign(id))) return { id, setCookie: null };
  }
  const id = randomUUID();
  return { id, setCookie: `rumi_sid=${id}.${sign(id)}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=86400` };
}
