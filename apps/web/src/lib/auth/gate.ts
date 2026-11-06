/**
 * Which pages need a signed-in person, and where the return path may point. Pure: no Supabase, no React, so the proxy,
 * the sign-in page and the callback route share one definition. tests/unit/authRequired.test.ts pins APP_ROUTES to the
 * folders of the (app) route group, so a new app screen cannot be left outside the gate.
 */
export const APP_ROUTES = ["/appointment", "/appointments", "/get-ready", "/home", "/kit", "/practice", "/record", "/remember", "/say-it", "/settings", "/share", "/welcome"] as const;

/** True for an app screen or anything below it. */
export const isAppPath = (pathname: string): boolean => APP_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));

const BASE = "http://rumi.invalid";

/**
 * A return path from `?next=` that is safe to redirect to: a same-site path that starts with one slash. Anything else
 * (another site, `//host`, a backslash, a control character, the sign-in and callback pages themselves) gives null.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 512 || !raw.startsWith("/") || raw.startsWith("//") || [...raw].some((c) => c === "\\" || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE || url.pathname.startsWith("/sign-in") || url.pathname.startsWith("/auth/")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The sign-in address for a visitor who asked for `path` (with its query). */
export const signInUrl = (path: string): string => {
  const next = safeNext(path);
  return next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in";
};
