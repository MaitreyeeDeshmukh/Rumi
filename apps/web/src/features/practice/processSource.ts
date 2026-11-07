/**
 * Turns something the person chose into words, then into a plan to practice with. Browser only.
 *  - a text file: read here
 *  - an audio file: sent to /api/voice/stt (one recording, at most 1.5 MB, about a minute)
 *  - words from a saved recording: already text
 * The words then go to the same plan call Get ready uses, which checks them for a crisis first.
 */
import { allOn, RAW_TEXT_MAX } from "@/features/practice/sources";
import { planCall } from "@/features/adapters/getReadyKit";
import type { VisitPlan } from "@/features/shared/types";
import { transcribeCall } from "@/lib/recordSpeech";

const TEXT_MAX_BYTES = 200_000;
/** The speech route takes at most this much (src/lib/voice/sttHandler.ts STT_BODY_MAX). */
const AUDIO_MAX_BYTES = 1_500_000;

export type ReadResult =
  | { ok: true; text: string; trimmed: boolean }
  | { ok: false; code: "bad_type" | "too_big" | "empty" | "failed" };

const isText = (f: File): boolean => f.type.startsWith("text/") || /\.(txt|md)$/i.test(f.name);
const isAudio = (f: File): boolean => f.type.startsWith("audio/");

const fit = (text: string): ReadResult => {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return { ok: false, code: "empty" };
  return { ok: true, text: t.slice(0, RAW_TEXT_MAX), trimmed: t.length > RAW_TEXT_MAX };
};

/** Words from a file the person chose. Never throws. */
export async function readFileWords(file: File): Promise<ReadResult> {
  if (isText(file)) {
    if (file.size > TEXT_MAX_BYTES) return { ok: false, code: "too_big" };
    try {
      return fit(await file.text());
    } catch {
      return { ok: false, code: "failed" };
    }
  }
  if (isAudio(file)) {
    if (file.size > AUDIO_MAX_BYTES) return { ok: false, code: "too_big" };
    const words = await transcribeCall(file);
    return words === null ? { ok: false, code: "failed" } : fit(words);
  }
  return { ok: false, code: "bad_type" };
}

export type PlanResult = { ok: true; plan: VisitPlan } | { ok: false; crisis: true } | { ok: false; crisis?: false };

/** Words in, plan to practice with out. The crisis check runs in planCall. */
export async function planFromWords(words: string, companionName: string, id: string): Promise<PlanResult> {
  const r = await planCall(words.slice(0, RAW_TEXT_MAX), companionName);
  if (r.ok) return { ok: true, plan: allOn({ ...r.data.plan, id }) };
  return "crisis" in r ? { ok: false, crisis: true } : { ok: false };
}
