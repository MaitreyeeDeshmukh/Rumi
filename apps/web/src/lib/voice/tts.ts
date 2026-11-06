/**
 * Text to speech through Cartesia (server only: the key never leaves this process).
 * Docs checked 2026-11-05: https://docs.cartesia.ai/api-reference/tts/bytes (request shape, mp3 output),
 * https://docs.cartesia.ai/api-reference/tts/tts (X-API-Key for servers) and
 * https://docs.cartesia.ai/build-with-cartesia/tts-models/latest (sonic-3.6 recommended; the voice is one of its
 * five listed English voices, "Jacqueline", en-US female).
 * The error carries a kind and nothing the provider said.
 */
import { ConfigError, getCartesiaConfig } from "@/lib/env";

const CARTESIA_URL = "https://api.cartesia.ai/tts/bytes";
const CARTESIA_MODEL = "sonic-3.6";
const CARTESIA_VOICE_ID = "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc";
const TTS_TIMEOUT_MS = 10_000;

export type TtsErrorKind = "config" | "timeout" | "http" | "empty";

export class TtsError extends Error {
  constructor(readonly kind: TtsErrorKind) {
    super(kind);
    this.name = "TtsError";
  }
}

interface Speech {
  bytes: ArrayBuffer;
  contentType: string;
}

interface SynthesizeDeps {
  fetchFn: typeof fetch;
  timeoutMs?: number;
}

/** One request to Cartesia. Only the text and fixed settings are sent: no session, address or other user data. */
export async function synthesize(text: string, { fetchFn, timeoutMs = TTS_TIMEOUT_MS }: SynthesizeDeps): Promise<Speech> {
  let config;
  try {
    config = getCartesiaConfig();
  } catch (e) {
    if (e instanceof ConfigError) throw new TtsError("config");
    throw e;
  }
  let res: Response;
  try {
    res = await fetchFn(CARTESIA_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "X-API-Key": config.apiKey, "Cartesia-Version": config.version, "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: CARTESIA_MODEL,
        transcript: text,
        voice: { id: CARTESIA_VOICE_ID },
        output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
        language: "en",
      }),
    });
  } catch {
    // An aborted or timed-out request and a network failure look the same to the caller.
    throw new TtsError("timeout");
  }
  if (!res.ok) throw new TtsError("http");
  let bytes: ArrayBuffer;
  try {
    bytes = await res.arrayBuffer();
  } catch {
    throw new TtsError("timeout");
  }
  if (bytes.byteLength === 0 || !(res.headers.get("content-type") ?? "").startsWith("audio/")) throw new TtsError("empty");
  return { bytes, contentType: "audio/mpeg" };
}
