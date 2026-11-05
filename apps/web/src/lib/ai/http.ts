import type { ApiErrorCode } from "@/features/shared/types";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    /** Seconds until the caller may try again. Sent as Retry-After on a 429. */
    readonly retryAfterSec?: number,
  ) {
    super(code);
    this.name = "HttpError";
  }
}

const MESSAGE: Record<ApiErrorCode, string> = {
  bad_input: "I could not read that. Check what you wrote and try again.",
  too_large: "That is too long. Make it shorter and try again.",
  forbidden: "This request was blocked. Reload the page and try again.",
  ai_invalid: "I could not make a safe answer. Your work is saved. Try again.",
  ai_unavailable: "I could not reach the AI. Your work is saved. Try again.",
  rate_limited: "That was too many tries. Wait one minute and try again.",
};

/** Every API answer is private: never cached by the browser, a proxy or the CDN. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

/** Whole seconds between 1 and 3600; 60 when the value is missing or not a finite number. */
const retryAfter = (sec: number | undefined): number => (sec !== undefined && Number.isFinite(sec) ? Math.min(3600, Math.max(1, Math.ceil(sec))) : 60);

export function errorResponse(e: HttpError): Response {
  const headers: Record<string, string> = e.status === 429 ? { "Retry-After": String(retryAfter(e.retryAfterSec)) } : {};
  return json({ error: { code: e.code, message: MESSAGE[e.code] } }, e.status, headers);
}

/**
 * Reads a JSON body with a hard byte cap. The declared Content-Length is checked first, then the stream is read
 * chunk by chunk and cancelled the moment the cap is passed, so a body without a length header cannot fill memory.
 */
export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new HttpError(400, "bad_input");
    if (Number(declared) > maxBytes) throw new HttpError(413, "too_large");
  }
  if (!req.body) throw new HttpError(400, "bad_input");

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "too_large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    // A "__proto__" key from the wire is dropped, so later object spreads or merges cannot be tricked.
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes), (key, value: unknown) => (key === "__proto__" ? undefined : value));
  } catch {
    // Invalid UTF-8 or invalid JSON: the caller only needs to know the body was unreadable.
    throw new HttpError(400, "bad_input");
  }
}
