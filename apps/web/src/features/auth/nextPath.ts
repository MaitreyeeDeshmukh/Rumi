const BASE = "http://rumi.invalid";
/** Pages a person is sent away from after logging in, so `next` pointing at them would loop. */
const AUTH_PAGES = new Set(["/login", "/signup", "/forgot-password", "/sign-in"]);

/**
 * Where to go after logging in or signing up. Only a path on this site is allowed: it starts with one "/", never "//" or "/\\"
 * (a browser reads both as another site), has no control characters, and is not the log-in or sign-up page itself.
 * Anything else, including a missing value, gives "/".
 */
export function safeNextPath(raw: string | string[] | null | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  for (const ch of value) {
    const c = ch.codePointAt(0) ?? 0;
    // Control characters, spaces and backslashes are refused: a browser may read them as part of another address.
    if (c <= 0x20 || c === 0x7f || ch === "\\") return "/";
  }
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE || AUTH_PAGES.has(url.pathname.replace(/(.)\/+$/, "$1"))) return "/";
    // "/.//x" normalises to "//x", which a browser reads as another site.
    const out = `${url.pathname}${url.search}${url.hash}`;
    return out.startsWith("//") ? "/" : out;
  } catch {
    return "/";
  }
}
