/** Why a recording ended: words came back, the microphone was refused, nothing was said, or the service failed. */
export type RecordEnd = "ok" | "denied" | "empty" | "failed";

export const canRecord = (): boolean =>
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

const MAX_MS = 60_000;

const pickType = (): string | undefined =>
  ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));

/** Sends one recording to /api/voice/stt. Returns the words, or null on any failure. Never throws. */
export async function transcribeCall(audio: Blob): Promise<string | null> {
  try {
    const res = await fetch("/api/voice/stt", {
      method: "POST",
      credentials: "same-origin",
      signal: AbortSignal.timeout(25_000),
      headers: { "Content-Type": audio.type || "audio/webm" },
      body: audio,
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { text?: unknown };
    return typeof j.text === "string" ? j.text : null;
  } catch {
    return null;
  }
}

/**
 * Records from the microphone, sends the audio to the server for transcription, then calls `onText` and `onEnd`.
 * Works in every browser with MediaRecorder (the browser's own dictation needs a vendor service and often fails).
 * Returns a function that stops the recording (the words are still sent). Stops by itself after a minute.
 */
export function recordAndTranscribe(onText: (text: string) => void, onEnd: (why: RecordEnd) => void): () => void {
  let stopped = false;
  let recorder: MediaRecorder | null = null;
  const stop = (): void => {
    stopped = true;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };
  void (async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      onEnd("denied");
      return;
    }
    if (stopped) {
      stream.getTracks().forEach((t) => t.stop());
      onEnd("empty");
      return;
    }
    const chunks: Blob[] = [];
    const mimeType = pickType();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder = rec;
    const timer = setTimeout(stop, MAX_MS);
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearTimeout(timer);
      const audio = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" });
      if (audio.size < 1500) return onEnd("empty");
      void transcribeCall(audio).then((text) => {
        if (text === null) return onEnd("failed");
        if (text.trim() === "") return onEnd("empty");
        onText(text.trim());
        onEnd("ok");
      });
    };
    rec.start();
  })();
  return stop;
}
