import { LIMITS } from "@/features/shared/constants";
import { HttpError } from "@/lib/ai/http";
import { assertSameOrigin } from "./origin";
import { clientIp, hashClientIp, rateLimiter, type RateLimiter } from "./rateLimit";
import { getSession } from "./session";

/** Recovery code format: 4 groups of 5 characters from an alphabet without 0, 1, I, O. The browser normalises case and dashes first. */
const KEY_RE = /^[A-HJ-NP-Z2-9]{5}(?:-[A-HJ-NP-Z2-9]{5}){3}$/;

export interface GuardResult {
  session: { id: string; setCookie: string | null };
  /** Keyed hash of the client address (16 hex characters). The address itself is never kept. */
  ipHash: string;
  /** The x-rumi-key recovery code when the header was sent and well formed. Validated for format only. */
  memoryKey: string | null;
}

export interface GuardOptions {
  maxBytes?: number;
  limiter?: RateLimiter;
}

/**
 * The checks every API route runs before it reads a body: same origin, session, rate limits, declared size and
 * the format of x-rumi-key. Memory and voice routes reuse it (07 D24). Throws HttpError; the caller turns it into
 * a response and appends `session.setCookie` to whatever response it returns.
 * It can also throw a plain Error when SESSION_SECRET is missing in production; routes treat that as a config error.
 */
export function guardRequest(req: Request, options: GuardOptions = {}): GuardResult {
  assertSameOrigin(req);
  const session = getSession(req);
  const ipHash = hashClientIp(clientIp(req));

  const verdict = (options.limiter ?? rateLimiter).check(ipHash, session.setCookie === null ? session.id : null);
  if (!verdict.ok) throw new HttpError(429, "rate_limited", verdict.retryAfterSec);

  const declared = req.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new HttpError(400, "bad_input");
    if (Number(declared) > (options.maxBytes ?? LIMITS.bodyBytesMax)) throw new HttpError(413, "too_large");
  }

  const key = req.headers.get("x-rumi-key");
  if (key !== null && !KEY_RE.test(key)) throw new HttpError(400, "bad_input");
  return { session, ipHash, memoryKey: key };
}
