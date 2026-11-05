import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { AppError } from "@/lib/errors";
import { publicSupabaseConfig } from "./config";
import { fetchWithTimeout } from "./fetch";

/**
 * Cookie-bound client with the publishable key: Postgres sees the caller's JWT, so RLS applies.
 * With `req` (route handlers) the session comes from that request's Cookie header, read only: proxy.ts has already
 * refreshed it and forwarded the fresh cookies. Without `req` (server components) it uses next/headers.
 */
export async function getServerClient(req?: Request): Promise<SupabaseClient> {
  const config = publicSupabaseConfig();
  if (!config) throw new AppError("config");
  const global = { fetch: fetchWithTimeout };
  if (req) {
    const jar = parseCookieHeader(req.headers.get("cookie") ?? "");
    return createServerClient(config.url, config.key, { global, cookies: { getAll: () => jar, setAll: () => undefined } });
  }
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    global,
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server components cannot write cookies. proxy.ts refreshes the session on every request, so nothing is lost.
        }
      },
    },
  });
}
