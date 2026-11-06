/**
 * Reads the public Supabase variables. `NEXT_PUBLIC_*` must be written as literal `process.env.NAME`
 * so Next can inline them into the browser bundle. This file is reachable from client code, so it holds nothing
 * private: the server-only admin client reads its own key.
 * null means "not configured": callers turn that into a degraded state, never a crash at import time.
 */
interface PublicSupabaseConfig {
  url: string;
  key: string;
}

export function publicSupabaseConfig(): PublicSupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;
  try {
    new URL(url);
  } catch {
    // A malformed URL is a configuration problem; the caller reports "not configured" without echoing the value.
    return null;
  }
  return { url, key };
}

/**
 * Kill switch for the session refresh in proxy.ts: AUTH_PROXY_REFRESH=off makes the proxy skip Supabase Auth
 * entirely (it still sets x-request-id). Any other value, or none, leaves the refresh on. API routes still verify
 * the caller themselves with requireUser, so turning this off never weakens authorization.
 */
export const authProxyRefreshEnabled = (): boolean => process.env.AUTH_PROXY_REFRESH?.trim().toLowerCase() !== "off";

/**
 * The demo escape hatch. Sign-up is REQUIRED unless NEXT_PUBLIC_AUTH_OPTIONAL is exactly "1": then the app keeps its
 * anonymous-first behaviour (no gate, anonymous users accepted). It is a literal `process.env.NAME` read so Next inlines
 * it into the browser bundle too, which is why it lives here and not in env.ts.
 */
export const authOptional = (): boolean => process.env.NEXT_PUBLIC_AUTH_OPTIONAL === "1";
