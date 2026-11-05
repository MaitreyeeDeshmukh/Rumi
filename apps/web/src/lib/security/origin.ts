import { HttpError } from "@/lib/ai/http";

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
  if (site === null && origin === null) throw new HttpError(403, "forbidden");
  if (site !== null && site !== "same-origin") throw new HttpError(403, "forbidden");
  if (origin === null) return;
  if (origin === "null") throw new HttpError(403, "forbidden");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    // An Origin header that is not a URL cannot come from a browser.
    throw new HttpError(403, "forbidden");
  }
  if (originHost === "" || originHost !== new URL(req.url).host) throw new HttpError(403, "forbidden");
}
