import { requireUser, type AuthedUser } from "@/lib/auth/requireUser";
import { LIMITS } from "@/features/shared/constants";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { requestIdOf } from "@/lib/requestContext";
import { assertSameOrigin } from "./origin";
import { clientIp, hashClientIp, rateLimiter, type RateLimiter } from "./rateLimit";

export interface GuardResult {
  /** The verified caller, or null when signed out (no token, auth unreachable, or auth not configured). */
  user: AuthedUser | null;
  /** Keyed hash of the client address (16 hex characters). The address itself is never kept. */
  ipHash: string;
}

export interface GuardOptions {
  maxBytes?: number;
  limiter?: RateLimiter;
  /** Routes that need a user: a signed-out caller gets 401 (or 503 when Supabase Auth cannot be reached). */
  requireAuth?: boolean;
}

/**
 * The checks every API route runs before it reads a body: same origin, who is calling, rate limits, declared size.
 * A signed-out caller is limited by hashed address only and passes unless `requireAuth` is set. Throws AppError only,
 * with fixed codes; nothing from a caught error's message is passed on.
 */
export function guardRequest(req: Request, options: GuardOptions & { requireAuth: true }): Promise<GuardResult & { user: AuthedUser }>;
export function guardRequest(req: Request, options?: GuardOptions): Promise<GuardResult>;
export async function guardRequest(req: Request, options: GuardOptions = {}): Promise<GuardResult> {
  try {
    assertSameOrigin(req);
    const ip = clientIp(req);
    const ipHash = hashClientIp(ip ?? "unknown");

    const declared = req.headers.get("content-length");
    if (declared !== null) {
      if (!/^\d+$/.test(declared)) throw new AppError("bad_input");
      if (Number(declared) > (options.maxBytes ?? LIMITS.bodyBytesMax)) throw new AppError("too_large");
    }

    let user: AuthedUser | null = null;
    try {
      user = await requireUser(req);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      if (options.requireAuth) throw e;
      // Signed out is a normal state (first visit, auth down). An outage or a config fault leaves one structured line.
      if (e.code !== "unauthorized") createLogger({ requestId: requestIdOf(req), route: new URL(req.url).pathname }).warn("auth_unverified", { code: e.code });
    }

    const verdict = (options.limiter ?? rateLimiter).check(ipHash, user?.userHash ?? null, ip === null);
    if (!verdict.ok) throw new AppError("rate_limited", { retryAfterSec: verdict.retryAfterSec });
    return { user, ipHash };
  } catch (e) {
    if (e instanceof AppError) throw e;
    // Anything unexpected becomes a fixed, generic error with the original kept only as the cause.
    throw new AppError("internal", { cause: e });
  }
}
