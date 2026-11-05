/**
 * POST /api/client-error. The browser tells us a page crashed: a fixed code, the page and Next's error digest. Nothing else is
 * accepted (no message, no stack, no user text). Same origin only, 2 KB cap, rate limited, written to ops_app_events.
 * The page must be a known route (routes.ts) or it is stored as "unknown"; digests are capped per page.
 */
import { z } from "zod";
import { HttpError, readJson } from "@/lib/ai/http";
import { AppError } from "@/lib/errors";
import { requestIdOf } from "@/lib/requestContext";
import { assertSameOrigin } from "@/lib/security/origin";
import { clientIp, createRateLimiter, hashClientIp, type RateLimiter } from "@/lib/security/rateLimit";
import { respondWithError } from "./respond";
import { knownRoute } from "./routes";
import { recordAppEvent } from "./sinks";

export const CLIENT_ERROR_MAX_BYTES = 2048;
export const CLIENT_ERROR_CODES = ["render_error", "global_error", "unhandled_rejection"] as const;

const schema = z.strictObject({
  code: z.enum(CLIENT_ERROR_CODES),
  // Any short string is accepted; knownRoute() turns everything that is not a real page into "unknown".
  route: z.string().max(120),
  fingerprint: z
    .string()
    .regex(/^[a-z0-9]{8,64}$/)
    .optional(),
});

/** Strict on purpose: a crash loop on one page, or a script, must not fill the table. Per instance, like the other limiters. */
export const clientErrorLimiter: RateLimiter = createRateLimiter({ limits: { perIp: 10, perSession: 10, perInstance: 120, perUnknownIp: 5 } });

/** Distinct digests stored per page per instance. A script inventing digests stops being stored after this. */
export const MAX_FINGERPRINTS_PER_ROUTE = 20;
const seenFingerprints = new Map<string, Set<string>>();

/** Tests only. */
export const resetSeenFingerprints = (): void => seenFingerprints.clear();

function admitFingerprint(route: string, fingerprint: string | undefined): string | undefined {
  if (fingerprint === undefined) return undefined;
  let seen = seenFingerprints.get(route);
  if (seen === undefined) seenFingerprints.set(route, (seen = new Set()));
  if (seen.has(fingerprint)) return fingerprint;
  if (seen.size >= MAX_FINGERPRINTS_PER_ROUTE) return undefined;
  seen.add(fingerprint);
  return fingerprint;
}

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
    const page = knownRoute(parsed.data.route);
    recordAppEvent({ source: "client", area: "app", code: parsed.data.code, fingerprint: admitFingerprint(page, parsed.data.fingerprint), route: page });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "x-request-id": requestId } });
  } catch (e) {
    return respondWithError(e, { requestId, route });
  }
}
