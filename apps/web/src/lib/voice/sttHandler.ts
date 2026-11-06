/**
 * POST /api/voice/stt. The body is one recording (audio/webm, ogg, mp4, mpeg or wav, at most 1.5 MB, about a minute).
 * Same steps as the other routes: guardRequest (origin, signed-in user, a limit of 30 per 10 minutes) -> type and size
 * checks -> Groq Whisper. Any provider problem is one generic 503 `ai_unavailable`; the screen then lets the person type.
 * The words come back as {text}; they are never logged. The crisis check runs when the words go to an AI route.
 */
import { HttpError, errorResponse } from "@/lib/ai/http";
import { AppError } from "@/lib/errors";
import { routeAuth } from "@/lib/auth/routeAuth";
import { createRateLimiter, type RateLimiter } from "@/lib/security/rateLimit";
import { guardRequest } from "@/lib/security/guardRequest";
import { extensionOf, transcribe } from "./stt";

export const STT_BODY_MAX = 1_500_000;
const MIN_BYTES = 800;
const sttLimiter = createRateLimiter({ limits: { perIp: 30, perSession: 30, perInstance: 300, windowMs: 600_000 } });

export interface SttHandlerDeps {
  fetchFn: typeof fetch;
  limiter?: RateLimiter;
  timeoutMs?: number;
}

export function createSttHandler({ fetchFn, limiter = sttLimiter, timeoutMs }: SttHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    try {
      await guardRequest(req, { ...routeAuth(), maxBytes: STT_BODY_MAX, limiter });
      const type = req.headers.get("content-type") ?? "";
      if (extensionOf(type) === null) throw new HttpError(400, "bad_input");
      const bytes = await req.arrayBuffer();
      if (bytes.byteLength > STT_BODY_MAX) throw new HttpError(413, "too_large");
      if (bytes.byteLength < MIN_BYTES) throw new HttpError(400, "bad_input");
      let text: string;
      try {
        text = await transcribe(bytes, type, { fetchFn, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
      } catch {
        throw new HttpError(503, "ai_unavailable");
      }
      return new Response(JSON.stringify({ text }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    } catch (e) {
      return errorResponse(e instanceof AppError ? e : new HttpError(503, "ai_unavailable"));
    }
  };
}

export const sttHandler = createSttHandler({ fetchFn: (input, init) => fetch(input, init) });
