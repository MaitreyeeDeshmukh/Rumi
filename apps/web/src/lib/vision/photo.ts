/**
 * Reading a photo of an appointment letter through the Groq vision model (server only: the key never leaves this process).
 * The only things sent are the picture and fixed instructions. The error carries a kind and nothing the provider said.
 * The picture is held in memory for this one request and is never written anywhere.
 */
import { AppointmentPhotoModelOut, type AppointmentPhotoModelOutT } from "@/features/shared/schemas";
import { ConfigError, getGroqVisionConfig } from "@/lib/env";
import { APPOINTMENT_PHOTO_SYSTEM, APPOINTMENT_PHOTO_USER } from "../../../prompts/appointmentScan";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const VISION_TIMEOUT_MS = 28_000;
const MAX_OUTPUT_TOKENS = 2000;
/** Groq refuses a base64 picture over 4 MB. Base64 is a third larger than the bytes, so the bytes stop at 3 MB. */
export const PHOTO_BYTES_MAX = 3_000_000;

export type VisionErrorKind = "config" | "timeout" | "http" | "empty";

export class VisionError extends Error {
  constructor(readonly kind: VisionErrorKind) {
    super(kind);
    this.name = "VisionError";
  }
}

export type PhotoMime = "image/jpeg" | "image/png" | "image/webp";
/** What the header may claim. The bytes decide (imageMime), so a renamed file is not accepted. */
export const PHOTO_MIMES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

/** The real type from the first bytes, or null when the bytes are not a JPEG, PNG or WebP picture. */
export function imageMime(bytes: ArrayBuffer): PhotoMime | null {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  const riff = String.fromCharCode(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0);
  const webp = String.fromCharCode(b[8] ?? 0, b[9] ?? 0, b[10] ?? 0, b[11] ?? 0);
  return riff === "RIFF" && webp === "WEBP" ? "image/webp" : null;
}

/** The JSON object in the model's text: the whole text, one fence around it, or the part from the first { to the last }. */
export function jsonIn(text: string): unknown {
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(t.slice(start, end + 1), (key, value: unknown) => (key === "__proto__" ? undefined : value));
  } catch {
    return undefined;
  }
}

export interface PhotoRead {
  out: AppointmentPhotoModelOutT;
  model: string;
  inTokens: number;
  outTokens: number;
}

const count = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

export async function readPhoto(
  bytes: ArrayBuffer,
  mime: PhotoMime,
  { fetchFn, today, timeoutMs = VISION_TIMEOUT_MS }: { fetchFn: typeof fetch; today: string; timeoutMs?: number },
): Promise<PhotoRead> {
  let config;
  try {
    config = getGroqVisionConfig();
  } catch (e) {
    if (e instanceof ConfigError) throw new VisionError("config");
    throw e;
  }
  const url = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  let res: Response;
  try {
    res = await fetchFn(GROQ_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: `${APPOINTMENT_PHOTO_SYSTEM}\nToday is ${today}.` },
          {
            role: "user",
            content: [
              { type: "text", text: APPOINTMENT_PHOTO_USER },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
        temperature: 0,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        response_format: { type: "json_object" },
        stream: false,
      }),
      cache: "no-store",
    });
  } catch {
    throw new VisionError("timeout");
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new VisionError("http");
  }
  let data: { choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new VisionError("empty");
  }
  const content = data.choices?.[0]?.message?.content;
  const parsed = AppointmentPhotoModelOut.safeParse(typeof content === "string" ? jsonIn(content) : undefined);
  if (!parsed.success) throw new VisionError("empty");
  return { out: parsed.data, model: config.model, inTokens: count(data.usage?.prompt_tokens), outTokens: count(data.usage?.completion_tokens) };
}
