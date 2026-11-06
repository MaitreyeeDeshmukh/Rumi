/**
 * Page routes the browser may name when it reports a crash. Anything else is stored as "unknown", so a script cannot
 * invent route names. A test fails when a static page exists under src/app that is not listed here: add it.
 * Dynamic pages (for example /plan/[id]) report as "unknown" on purpose: their path holds ids.
 */
export const KNOWN_ROUTES: ReadonlySet<string> = new Set([
  "/", "/about", "/accessibility", "/appointment", "/appointments", "/appointments/new", "/contact", "/forgot-password", "/get-ready", "/help", "/home", "/how-it-works", "/kit", "/login", "/practice",
  "/privacy", "/record", "/remember", "/safety", "/say-it", "/settings", "/share", "/sign-in", "/signup", "/welcome", "/%5Ferror-test",
]);

/** The route if it is a known page (query and trailing slash ignored), else "unknown". */
export function knownRoute(route: string): string {
  const path = (route.split(/[?#]/)[0] ?? "").replace(/(.)\/+$/, "$1");
  return KNOWN_ROUTES.has(path) ? path : "unknown";
}
