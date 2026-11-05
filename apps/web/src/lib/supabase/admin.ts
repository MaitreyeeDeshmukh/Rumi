import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";
import { publicSupabaseConfig } from "./config";
import { ADMIN_TIMEOUT_MS, timeoutFetch } from "./fetch";

let cached: SupabaseClient | undefined;

/** undefined when unset. The only place this variable is read. */
const secretKey = (): string | undefined => process.env.SUPABASE_SECRET_KEY?.trim() || undefined;

/** Bypasses RLS. Server only: `server-only` fails the build if a client module imports this file, and a bundle test checks it. */
export function getAdminClient(): SupabaseClient {
  if (cached) return cached;
  const config = publicSupabaseConfig();
  const key = secretKey();
  if (!config || !key) throw new AppError("config");
  cached = createClient(config.url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timeoutFetch(ADMIN_TIMEOUT_MS) },
  });
  return cached;
}
