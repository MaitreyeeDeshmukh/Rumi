import type { ApiErrorCode } from "@/features/shared/types";
import { AppError, toResponse } from "@/lib/errors";

/** The older constructor shape, kept so every caller still works. It is an AppError, so toResponse and the logger treat it alike. */
export class HttpError extends AppError {
  declare readonly code: ApiErrorCode;
  constructor(
    status: number,
    code: ApiErrorCode,
    /** Seconds until the caller may try again. Sent as Retry-After on a 429. */
    retryAfterSec?: number,
  ) {
    super(code, { status, retryAfterSec });
    this.name = "HttpError";
  }
}

/** Every API answer is private: never cached by the browser, a proxy or the CDN. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

/** Whole seconds between 1 and 86400 (a day: the daily limit resets at UTC midnight); 60 when the value is missing or not a finite number. */
export const retryAfter = (sec: number | undefined): number => (sec !== undefined && Number.isFinite(sec) ? Math.min(86_400, Math.max(1, Math.ceil(sec))) : 60);

/** Answer for a thrown HttpError (the hardened harness' error path): code and a fixed sentence, Retry-After on a 429. */
export function errorResponse(e: AppError, requestId: string = crypto.randomUUID()): Response {
  return toResponse(e, requestId);
}

/**
 * Reads a JSON body with a hard byte cap. The declared Content-Length is checked first, then the stream is read
 * chunk by chunk and cancelled the moment the cap is passed, so a body without a length header cannot fill memory.
 * A body that is not finished after `timeoutMs` is cancelled and refused (a slow-body client cannot hold the request open).
 */
export async function readJson(req: Request, maxBytes: number, timeoutMs = 10_000): Promise<unknown> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new HttpError(400, "bad_input");
    if (Number(declared) > maxBytes) throw new HttpError(413, "too_large");
  }
  if (!req.body) throw new HttpError(400, "bad_input");

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => undefined); // best effort: the request is refused either way
  }, timeoutMs);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      // Cancelling ends the pending read with "done", so a body cut off by the timeout must not pass as complete.
      if (timedOut) throw new HttpError(400, "bad_input");
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "too_large");
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
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
