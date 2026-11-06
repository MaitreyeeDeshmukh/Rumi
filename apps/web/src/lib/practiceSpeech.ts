import { canRecord, recordAndTranscribe } from "@/lib/recordSpeech";
// Speech for the practice call screen. Both parts are optional: callers check canSpeak and canListen first.

export const canSpeak = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window;

/** Reads the text aloud. `onEnd` runs when it finishes or is stopped. */
export function speak(text: string, rate: number, onEnd: () => void): void {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  u.onend = onEnd;
  u.onerror = onEnd;
  window.speechSynthesis.speak(u);
}

export const stopSpeaking = (): void => {
  if (canSpeak()) window.speechSynthesis.cancel();
};

type Recognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognizerClass = new () => Recognizer;

const recognizerClass = (): RecognizerClass | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognizerClass; webkitSpeechRecognition?: RecognizerClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const canListen = (): boolean => canRecord() || recognizerClass() !== null;

/** Starts one dictation. `onText` gets the words, `onEnd` runs when it stops. Returns a function that stops it. */
export function listen(onText: (text: string) => void, onEnd: () => void): () => void {
  // Recording plus server transcription first (works in every browser that can record); the browser's own dictation is the fallback.
  if (canRecord()) return recordAndTranscribe(onText, () => onEnd());
  const Rec = recognizerClass();
  if (!Rec) return () => {};
  const rec = new Rec();
  rec.lang = document.documentElement.lang || "en-US";
  rec.continuous = false;
  rec.interimResults = false;
  rec.onresult = (e) => onText(Array.from(e.results, (r) => r[0].transcript).join(" "));
  rec.onend = onEnd;
  rec.onerror = onEnd;
  rec.start();
  return () => rec.abort();
}
