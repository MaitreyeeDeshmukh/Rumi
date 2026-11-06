/**
 * POST /api/voice/tts. Steps, in order, each failure a fixed error body (the same ones the other routes send):
 * guardRequest (same origin, session, a stricter limit of 30 per 10 minutes, declared size) -> body read with a
 * 4 KB cap -> strict schema -> text cleaned with promptForm -> Cartesia. Any provider problem is one generic 503
 * `ai_unavailable`, which the screen answers by using the browser voice. The text is spoken as given (a crisis
 * message is spoken like any other) and is never logged.
 * Telemetry is skipped on purpose: AiEvent has no voice task and adding one is a schema change (I-112).
 */
import { z } from "zod";
import { HttpError, errorResponse, readJson } from "@/lib/ai/http";
import { promptForm } from "@/lib/ai/guards/input";
import { createRateLimiter, type RateLimiter } from "@/lib/security/rateLimit";
import { guardRequest } from "@/lib/security/guardRequest";
import { synthesize } from "./tts";
import { VOICE_KEYS } from "./voices";

const TTS_BODY_MAX = 4_096;
const TEXT_MAX = 600;
const TtsRequest = z.object({ text: z.string().min(1).max(TEXT_MAX), voice: z.enum(VOICE_KEYS).optional() }).strict();

/** Per serverless instance, like the shared limiter (best effort). Replaces it for this route: stricter overall. */
const ttsLimiter = createRateLimiter({ limits: { perIp: 30, perSession: 30, perInstance: 300, windowMs: 600_000 } });

export interface TtsHandlerDeps {
  fetchFn: typeof fetch;
  limiter?: RateLimiter;
  timeoutMs?: number;
}

export function createTtsHandler({ fetchFn, limiter = ttsLimiter, timeoutMs }: TtsHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    try {
      await guardRequest(req, { maxBytes: TTS_BODY_MAX, limiter });
      const body = TtsRequest.safeParse(await readJson(req, TTS_BODY_MAX));
      if (!body.success) throw new HttpError(400, "bad_input");
      // NFKC can lengthen text, so the limit is checked again on the cleaned form.
      const text = promptForm(body.data.text);
      if (text.length === 0 || text.length > TEXT_MAX) throw new HttpError(400, "bad_input");

      let speech;
      try {
        speech = await synthesize(text, { fetchFn, ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(body.data.voice === undefined ? {} : { voice: body.data.voice }) });
      } catch {
        throw new HttpError(503, "ai_unavailable");
      }
      const answer = new Response(speech.bytes, { headers: { "Content-Type": speech.contentType, "Cache-Control": "no-store" } });
      return answer;
    } catch (e) {
      return errorResponse(e instanceof HttpError ? e : new HttpError(503, "ai_unavailable"));
    }
  };
}

/** The instance the route file uses. Nothing is read from the environment until a request arrives. */
export const ttsHandler = createTtsHandler({ fetchFn: (input, init) => fetch(input, init) });
