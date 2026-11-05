/**
 * POST /api/client-error. The browser tells us a page crashed: a fixed code, the route and Next's error digest. Nothing else is
 * accepted (no message, no stack, no user text). Same origin only, 2 KB cap, rate limited, written to ops_app_events.
 */
import { z } from "zod";
import { HttpError, readJson } from "@/lib/ai/http";
import { AppError } from "@/lib/errors";
import { requestIdOf } from "@/lib/requestContext";
import { assertSameOrigin } from "@/lib/security/origin";
import { clientIp, createRateLimiter, hashClientIp, type RateLimiter } from "@/lib/security/rateLimit";
import { respondWithError } from "./respond";
import { recordAppEvent } from "./sinks";

export const CLIENT_ERROR_MAX_BYTES = 2048;
export const CLIENT_ERROR_CODES = ["render_error", "global_error", "unhandled_rejection"] as const;

const schema = z.strictObject({
  code: z.enum(CLIENT_ERROR_CODES),
  route: z.string().regex(/^\/[A-Za-z0-9/_.[\]()@-]{0,79}$/),
  fingerprint: z.string().regex(/^[A-Za-z0-9]{1,64}$/).optional(),
});

/** Strict on purpose: a crash loop on one page, or a script, must not fill the table. Per instance, like the other limiters. */
export const clientErrorLimiter: RateLimiter = createRateLimiter({ limits: { perIp: 10, perSession: 10, perInstance: 120, perUnknownIp: 5 } });

export async function handleClientError(req: Request, limiter: RateLimiter = clientErrorLimiter): Promise<Response> {
  const requestId = requestIdOf(req);
  const route = "/api/client-error";
  try {
    assertSameOrigin(req);
    const ip = clientIp(req);
    const verdict = limiter.check(hashClientIp(ip ?? "unknown"), null, ip === null);
    if (!verdict.ok) throw new HttpError(429, "rate_limited", verdict.retryAfterSec);
    const parsed = schema.safeParse(await readJson(req, CLIENT_ERROR_MAX_BYTES));
    if (!parsed.success) throw new AppError("bad_input");
    const { code, route: page, fingerprint } = parsed.data;
    recordAppEvent({ source: "client", area: "app", code, fingerprint, route: page });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "x-request-id": requestId } });
  } catch (e) {
    return respondWithError(e, { requestId, route });
  }
}
