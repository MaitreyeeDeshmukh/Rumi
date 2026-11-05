import { AppError } from "@/lib/errors";

/**
 * CSRF protection only: it stops another website from making a visitor's browser call our API.
 * It does not stop a script that sends its own headers; the rate limits and the provider spend cap do that.
 *
 * A browser always sends Sec-Fetch-Site and Origin on a fetch POST. A request with neither is not a browser
 * fetch, an `Origin: null` comes from a sandboxed or redirected context, and an unparsable Origin is forged.
 */
export function assertSameOrigin(req: Request): void {
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if (site === null && origin === null) throw new AppError("forbidden");
  if (site !== null && site !== "same-origin") throw new AppError("forbidden");
  if (origin === null) return;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    // "null" (sandboxed or redirected contexts) and any other value that is not a URL cannot be a same-origin browser fetch.
    throw new AppError("forbidden");
  }
  // Only web origins. A request that arrived over https must have an https origin; plain http is for local development.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new AppError("forbidden");
  const target = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? target.protocol.slice(0, -1);
  if (proto === "https" && parsed.protocol !== "https:") throw new AppError("forbidden");
  if (parsed.host === "" || parsed.host !== target.host) throw new AppError("forbidden");
}
