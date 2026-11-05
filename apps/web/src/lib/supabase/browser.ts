import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "./config";

/** Publishable key only. RLS is the protection, not secrecy. Throws a fixed Error when not configured (AuthProvider turns it into `degraded`). */
export function getBrowserClient(): SupabaseClient {
  const config = publicSupabaseConfig();
  if (!config) throw new Error("supabase_not_configured");
  // In the browser createBrowserClient returns one shared instance, so every caller sees the same session.
  return createBrowserClient(config.url, config.key);
}
