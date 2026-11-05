/**
 * The Content-Security-Policy, built in one place so next.config.ts and a test use the same code.
 * connect-src gets exactly one extra origin: the Supabase project in NEXT_PUBLIC_SUPABASE_URL (Auth calls from the browser).
 * Realtime (wss) is not used, so no wss entry is added for Supabase.
 */

/** The origin of the Supabase project, or null when the value is missing or not an http(s) URL. Plain http only for localhost. */
export function supabaseOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    return u.protocol === "https:" || (u.protocol === "http:" && local) ? u.origin : null;
  } catch {
    return null;
  }
}

export function buildCsp(options: { isDev: boolean; supabaseUrl?: string }): string {
  const supabase = supabaseOrigin(options.supabaseUrl);
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${options.isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src 'self' https://api.cartesia.ai wss://api.cartesia.ai${supabase ? ` ${supabase}` : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
