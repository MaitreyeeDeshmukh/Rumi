import { requireUser, type AuthedUser } from "@/lib/auth/requireUser";
import { LIMITS } from "@/features/shared/constants";
import { AppError, fingerprintOf } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { requestIdOf } from "@/lib/requestContext";
import { recordAppEvent } from "@/lib/telemetry/sinks";
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
  /** How the caller is verified. Default: requireUser. `null` skips the lookup (MOCK_AI: nothing may touch Supabase). */
  authenticate?: ((req: Request) => Promise<AuthedUser>) | null;
}

/**
 * The checks every API route runs before it reads a body: same origin, declared size, the address rate limit, who
 * is calling (Supabase Auth), then that user's own rate limit.
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

    // The address limit runs first, so a flood of requests cannot make us call Supabase Auth for each one.
    const limiter = options.limiter ?? rateLimiter;
    const ipVerdict = limiter.check(ipHash, null, ip === null);
    if (!ipVerdict.ok) throw new AppError("rate_limited", { retryAfterSec: ipVerdict.retryAfterSec });

    let user: AuthedUser | null = null;
    const authenticate = options.authenticate === undefined ? requireUser : options.authenticate;
    try {
      if (authenticate !== null) user = await authenticate(req);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      // An auth fault of ours (outage, configuration) is counted once, here, whether the route needs a user or not: the
      // app_errors alert reads app events, and a stdout line alone never reaches it. A caller fault (4xx) is not an alert.
      if (e.status >= 500) recordAppEvent({ source: "server", area: "auth", code: e.code, fingerprint: fingerprintOf(e), route: new URL(req.url).pathname, status: e.status });
      if (options.requireAuth) throw e;
      // Signed out is a normal state (first visit, auth down). An outage leaves one warning; a configuration fault is an error.
      if (e.code !== "unauthorized") {
        const log = createLogger({ requestId: requestIdOf(req), route: new URL(req.url).pathname });
        if (e.code === "config") log.error("auth_unverified", e, { code: e.code });
        else log.warn("auth_unverified", { code: e.code });
      }
    }

    if (user !== null) {
      const userVerdict = limiter.checkUser(user.userHash);
      if (!userVerdict.ok) throw new AppError("rate_limited", { retryAfterSec: userVerdict.retryAfterSec });
    }
    return { user, ipHash };
  } catch (e) {
    if (e instanceof AppError) throw e;
    // Anything unexpected becomes a fixed, generic error with the original kept only as the cause.
    const fault = new AppError("internal", { cause: e });
    recordAppEvent({ source: "server", area: "app", code: fault.code, fingerprint: fingerprintOf(e), route: new URL(req.url).pathname, status: fault.status });
    throw fault;
  }
}
