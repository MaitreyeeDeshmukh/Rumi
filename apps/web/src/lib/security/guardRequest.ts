import { LIMITS, RECOVERY_CODE_RE } from "@/features/shared/constants";
import { HttpError } from "@/lib/ai/http";
import { assertSameOrigin } from "./origin";
import { clientIp, hashClientIp, rateLimiter, type RateLimiter } from "./rateLimit";
import { getSession, type Session } from "./session";

export interface GuardResult {
  /** `id` is null when no signing secret is usable; the request is then limited by address only. */
  session: Session;
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
 * the format of x-rumi-key. Memory and voice routes reuse it (07 D24). Throws HttpError only, with fixed codes;
 * the caller turns it into a response and appends `session.setCookie` to whatever response it returns.
 * A configuration problem never fails the request: the session is dropped and the limit falls back to the address.
 */
export function guardRequest(req: Request, options: GuardOptions = {}): GuardResult {
  try {
    assertSameOrigin(req);
    const session = getSession(req);
    const ip = clientIp(req);
    const ipHash = hashClientIp(ip ?? "unknown");

    const countedSession = session.id !== null && session.setCookie === null ? session.id : null;
    const verdict = (options.limiter ?? rateLimiter).check(ipHash, countedSession, ip === null);
    if (!verdict.ok) throw new HttpError(429, "rate_limited", verdict.retryAfterSec);

    const declared = req.headers.get("content-length");
    if (declared !== null) {
      if (!/^\d+$/.test(declared)) throw new HttpError(400, "bad_input");
      if (Number(declared) > (options.maxBytes ?? LIMITS.bodyBytesMax)) throw new HttpError(413, "too_large");
    }

    const key = req.headers.get("x-rumi-key");
    if (key !== null && !RECOVERY_CODE_RE.test(key)) throw new HttpError(400, "bad_input");
    return { session, ipHash, memoryKey: key };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    // Anything unexpected becomes a fixed, generic error; nothing from the original message is passed on.
    throw new HttpError(503, "ai_unavailable");
  }
}
