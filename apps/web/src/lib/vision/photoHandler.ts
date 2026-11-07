/**
 * POST /api/appointment/photo. The body is one picture of an appointment letter (JPEG, PNG or WebP, at most 3 MB).
 * Same steps as /api/voice/stt: guardRequest (origin, signed-in user, a limit of 20 per 10 minutes) -> type and size
 * checks (the first bytes must really be a picture) -> Groq vision -> every value checked against the words read from the picture.
 * The picture is never stored or logged. Any provider problem is one generic 503 `ai_unavailable`; the screen then lets the person type.
 * The answer is {fields, text}: a draft the person checks and confirms. It is never saved here.
 */
import { scanByRules } from "@/features/appointmentScan/rules";
import { filledCount, groundFields } from "@/features/appointmentScan/ground";
import { SAMPLE_LETTER } from "@/fixtures/sampleLetter";
import { isoDate } from "@/features/appointments/appointments";
import type { AppointmentPhotoReplyT } from "@/features/shared/schemas";
import { HttpError, errorResponse } from "@/lib/ai/http";
import { stripUrls } from "@/lib/ai/guards/output";
import { estimateCostMicroUsd } from "@/lib/ai/cost";
import { logEvent, type AiEvent } from "@/lib/ai/telemetry";
import { routeAuth } from "@/lib/auth/routeAuth";
import { mockAiEnabled } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { guardRequest } from "@/lib/security/guardRequest";
import { createRateLimiter, type RateLimiter } from "@/lib/security/rateLimit";
import { PHOTO_BYTES_MAX, PHOTO_MIMES, imageMime, readPhoto } from "./photo";
import { APPOINTMENT_SCAN_VERSION } from "../../../prompts/appointmentScan";

export const PHOTO_BODY_MAX = PHOTO_BYTES_MAX;
const MIN_BYTES = 1_000;
const photoLimiter = createRateLimiter({ limits: { perIp: 20, perSession: 20, perInstance: 200, windowMs: 600_000 } });

export interface PhotoHandlerDeps {
  fetchFn: typeof fetch;
  limiter?: RateLimiter;
  timeoutMs?: number;
  now?: () => Date;
}

const send = (reply: AppointmentPhotoReplyT): Response =>
  new Response(JSON.stringify(reply), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** Codes and counts only. No text, no picture. */
function record(ev: Partial<AiEvent>, startedAt: number): void {
  logEvent({
    id: crypto.randomUUID(),
    task: "appointmentScan",
    promptVersion: APPOINTMENT_SCAN_VERSION,
    outcome: "error",
    degraded: false,
    attempts: 0,
    tier: "none",
    redactions: 0,
    injectionHits: 0,
    thin: false,
    guardHits: [],
    memoryItems: 0,
    inTokens: 0,
    outTokens: 0,
    ms: Date.now() - startedAt,
    ...ev,
  });
}

export function createPhotoHandler({ fetchFn, limiter = photoLimiter, timeoutMs, now = () => new Date() }: PhotoHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const startedAt = Date.now();
    try {
      await guardRequest(req, { ...routeAuth(), maxBytes: PHOTO_BODY_MAX, limiter });
      const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!PHOTO_MIMES.includes(type)) throw new HttpError(400, "bad_input");
      const bytes = await req.arrayBuffer();
      if (bytes.byteLength > PHOTO_BODY_MAX) throw new HttpError(413, "too_large");
      const mime = imageMime(bytes);
      if (bytes.byteLength < MIN_BYTES || mime === null) throw new HttpError(400, "bad_input");

      // A demo run with no AI: the made-up sample letter stands in, so the screens can be tried end to end.
      if (mockAiEnabled()) {
        record({ outcome: "mock" }, startedAt);
        return send({ fields: scanByRules(SAMPLE_LETTER, now()), text: SAMPLE_LETTER });
      }

      let read;
      try {
        read = await readPhoto(bytes, mime, { fetchFn, today: isoDate(now()), ...(timeoutMs === undefined ? {} : { timeoutMs }) });
      } catch {
        record({ outcome: "fallback", degraded: true, errorCode: "ai_unavailable", providerKind: "http" }, startedAt);
        throw new HttpError(503, "ai_unavailable");
      }
      // The words read from the picture are the source every value is checked against. Links are removed from them first.
      const text = stripUrls(read.out.transcript).replace(/[ \t]+/g, " ").trim();
      let fields = groundFields(read.out, text);
      if (filledCount(fields) === 0 && text !== "") fields = scanByRules(text, now());
      record(
        {
          outcome: "ok",
          attempts: 1,
          tier: "quality",
          inTokens: read.inTokens,
          outTokens: read.outTokens,
          costMicroUsd: estimateCostMicroUsd(read.model, read.inTokens, read.outTokens),
        },
        startedAt,
      );
      return send({ fields, text, ...(text === "" ? { degraded: true } : {}) });
    } catch (e) {
      return errorResponse(e instanceof AppError ? e : new HttpError(503, "ai_unavailable"));
    }
  };
}

export const photoHandler = createPhotoHandler({ fetchFn: (input, init) => fetch(input, init) });
