import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createLogger } from "@/lib/log";
import { newRequestId, REQUEST_ID_HEADER } from "@/lib/requestContext";
import { publicSupabaseConfig } from "@/lib/supabase/config";
import { fetchWithTimeout } from "@/lib/supabase/fetch";

/** Supabase stores its session in cookies named `sb-<project>-auth-token` (plus `.0`, `.1` chunks). */
const hasSessionCookie = (req: NextRequest): boolean => req.cookies.getAll().some((c) => c.name.startsWith("sb-"));

/**
 * Runs before every page and API route (not static files). It does two things and never blocks a request:
 * 1. gives the request a fresh x-request-id (a client-sent one is ignored) and echoes it on the response;
 * 2. refreshes the Supabase session when the visitor has one, and forwards the refreshed cookies to the route
 *    and to the browser. A visitor with no session cookie costs no network call.
 * An auth outage only means the session is not refreshed this time; the page still loads.
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
  if (!config || !hasSessionCookie(request)) return response;

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
  let unreachable = false;
  try {
    // getUser() asks the Auth server to verify the token and refreshes it when needed. Never getSession() here.
    const { error } = await supabase.auth.getUser();
    // A rejected token (4xx) is the visitor's state, not a fault. Only an unreachable or failing Auth server is logged.
    unreachable = error !== null && (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500);
  } catch {
    // getUser reports faults as values; a throw here is unexpected. Treat it as an outage and serve the page anyway.
    unreachable = true;
  }
  if (unreachable) createLogger({ requestId, route: request.nextUrl.pathname }).warn("session_refresh_failed");
  return response;
}

export const config = {
  // Skip Next internals and any path with a file extension (images, fonts, sounds, the service of static assets).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
