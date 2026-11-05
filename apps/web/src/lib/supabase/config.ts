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
