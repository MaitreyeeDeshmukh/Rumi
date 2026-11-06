/**
 * Speech to text through Groq Whisper (server only: the key never leaves this process).
 * https://console.groq.com/docs/speech-to-text. The error carries a kind and nothing the provider said.
 */
import { ConfigError, getGroqSttConfig } from "@/lib/env";

const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const STT_TIMEOUT_MS = 20_000;
const TEXT_MAX = 2_000;

export type SttErrorKind = "config" | "timeout" | "http";

export class SttError extends Error {
  constructor(readonly kind: SttErrorKind) {
    super(kind);
    this.name = "SttError";
  }
}

const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};
export const extensionOf = (contentType: string): string | null => EXT[contentType.split(";")[0].trim().toLowerCase()] ?? null;

/** One request to Groq. Only the audio and fixed settings are sent. Returns the words ("" when nothing was said). */
export async function transcribe(
  bytes: ArrayBuffer,
  contentType: string,
  { fetchFn, timeoutMs = STT_TIMEOUT_MS }: { fetchFn: typeof fetch; timeoutMs?: number },
): Promise<string> {
  let config;
  try {
    config = getGroqSttConfig();
  } catch (e) {
    if (e instanceof ConfigError) throw new SttError("config");
    throw e;
  }
  const ext = extensionOf(contentType) ?? "webm";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: contentType.split(";")[0].trim() }), `speech.${ext}`);
  form.append("model", config.model);
  form.append("language", "en");
  form.append("response_format", "json");
  form.append("temperature", "0");
  let res: Response;
  try {
    res = await fetchFn(GROQ_STT_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
    });
  } catch {
    throw new SttError("timeout");
  }
  if (!res.ok) throw new SttError("http");
  try {
    const j = (await res.json()) as { text?: unknown };
    return typeof j.text === "string" ? j.text.trim().slice(0, TEXT_MAX) : "";
  } catch {
    throw new SttError("http");
  }
}
