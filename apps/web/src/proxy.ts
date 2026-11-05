import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { classifyError, isRetryable } from "@/features/auth/mapError";
import { noteAuthRateLimited } from "@/lib/auth/authFault";
import { createLogger } from "@/lib/log";
import { newRequestId, REQUEST_ID_HEADER } from "@/lib/requestContext";
import { authProxyRefreshEnabled, publicSupabaseConfig } from "@/lib/supabase/config";
import { fetchWithTimeout } from "@/lib/supabase/fetch";

/** Supabase stores its session in cookies named `sb-<project>-auth-token` (plus `.0`, `.1` chunks). */
const hasSessionCookie = (req: NextRequest): boolean => req.cookies.getAll().some((c) => c.name.startsWith("sb-"));

/**
 * Runs before every page and API route (not static files). It does two things and never blocks a request:
 * 1. gives the request a fresh x-request-id (a client-sent one is ignored) and echoes it on the response;
 * 2. keeps the Supabase session fresh when the visitor has one, and forwards refreshed cookies to the route and to
 *    the browser. It uses getClaims(): the access token is checked locally against Auth's cached public keys, and the
 *    network is used only to REFRESH a token that is expired or about to expire (supabase-js refreshes inside its
 *    margin of 90 seconds). A visitor with no session cookie costs no call at all. It is the pattern in the
 *    @supabase/ssr docs; the per-request authoritative check stays in requireUser (getUser) on API routes.
 *    Projects that still sign tokens with a shared secret (HS256) make getClaims fall back to one getUser call.
 * AUTH_PROXY_REFRESH=off skips all of step 2. An auth outage only means the session is not refreshed this time;
 * the page still loads.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const requestId = newRequestId();
  const forward = (): NextResponse => {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    const next = NextResponse.next({ request: { headers } });
    next.headers.set(REQUEST_ID_HEADER, requestId);
    return next;
  };
  let response = forward();

  const config = publicSupabaseConfig();
  if (!authProxyRefreshEnabled() || !config || !hasSessionCookie(request)) return response;

  const supabase = createServerClient(config.url, config.key, {
    global: { fetch: fetchWithTimeout },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, cacheHeaders) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = forward();
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        // Responses that carry a session must not be cached by a CDN.
        for (const [key, value] of Object.entries(cacheHeaders)) response.headers.set(key, value);
      },
    },
  });
  let outcome: "ok" | "unreachable" | "limited" = "ok";
  try {
    // Never getSession() or getUser() here. A rejected token (4xx) is the visitor's state, not a fault.
    const { error } = await supabase.auth.getClaims();
    if (error) {
      const kind = classifyError(error);
      outcome = kind === "rate_limited" ? "limited" : isRetryable(kind) ? "unreachable" : "ok";
    }
  } catch {
    // getClaims reports faults as values; a throw here is unexpected. Treat it as an outage and serve the page anyway.
    outcome = "unreachable";
  }
  const ctx = { requestId, route: request.nextUrl.pathname };
  if (outcome === "limited") noteAuthRateLimited(ctx);
  else if (outcome === "unreachable") createLogger(ctx).warn("session_refresh_failed");
  return response;
}

export const config = {
  // Skip Next internals and any path with a file extension (images, fonts, sounds, the service of static assets).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
