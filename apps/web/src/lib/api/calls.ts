/**
 * What the screens call. One function per AI route, wired to the browser's fetch, the crisis check and the online
 * flag, so a screen cannot forget the two rules that matter (I-035):
 *  - the crisis check looks only at text the person typed in THIS request. A plan item or a clinician line that
 *    mentions a symptom ("any chest pain?") must not trap the person in the crisis card. `createCallApi` falls back
 *    to the whole body when the list is empty, so a request with nothing typed says so with `skipCrisisCheck`
 *    (the server still checks);
 *  - the recovery code and the stated support sentences travel only while memory is on (`memoryCodeFor`).
 * Every call takes the current `RumiState` and never throws; the result is an `ApiResult`.
 */
import type { VoiceKey } from '@/lib/voice/voices';
import {
  AppointmentPhotoReply,
  AppointmentScanReply,
  LookupReply,
  PlanReply,
  PracticeReply,
  RecapReply,
  SayItReply,
  type AppointmentPhotoReplyT,
  type AppointmentScanReplyT,
  type AppointmentScanRequestT,
  type LookupReplyT,
  type LookupRequestT,
  type PlanReplyT,
  type PlanRequestT,
  type PracticeReplyT,
  type PracticeRequestT,
  type RecapReplyT,
  type RecapRequestT,
  type SayItReplyT,
  type SayItRequestT,
} from '@/features/shared/schemas';
import type { ApiResult, RumiState } from '@/features/shared/types';
import { isCrisis } from '@/lib/crisis';
import { createCallApi, type CallOpts } from './client';

type CallApi = ReturnType<typeof createCallApi>;

/** Persona memory is Supabase-based on this line and read server-side, so no recovery code or facts travel in the body. */
function withMemory<T extends object>(_state: RumiState, body: T): { body: T; memoryCode?: string } {
  return { body };
}

const opts = (memoryCode: string | undefined, typed: readonly string[]): CallOpts => ({
  ...(memoryCode === undefined ? {} : { memoryCode }),
  // An empty typedText would mean "check everything", so a request with no typed text turns the client check off instead.
  ...(typed.length > 0 ? { typedText: typed } : { skipCrisisCheck: true }),
});

/** The newest thing the person said in a practice turn list, or nothing. */
function latestMeTurn(turns: PracticeRequestT['turns']): string[] {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'me') return [turns[i].text];
  return [];
}

const calls = (callApi: CallApi) => ({
    /** Typed: rawText. */
    planCall(state: RumiState, req: PlanRequestT): Promise<ApiResult<PlanReplyT>> {
      const { body, memoryCode } = withMemory(state, req);
      return callApi('/api/plan', body, PlanReply, opts(memoryCode, [req.rawText]));
    },
    /** Typed: the latest `me` turn only. The plan, the focus and the clinician's lines were not typed in this request. */
    practiceCall(state: RumiState, req: PracticeRequestT): Promise<ApiResult<PracticeReplyT>> {
      const { body, memoryCode } = withMemory(state, req);
      return callApi('/api/practice', body, PracticeReply, opts(memoryCode, latestMeTurn(req.turns)));
    },
    /**
     * Typed: clinicianQuestion, unless `clinicianLineTyped` is false. Pass false when the line came from the practice
     * conversation (written by the AI, not by the person), so a symptom word in it cannot trigger the crisis card.
     */
    sayItCall(state: RumiState, req: SayItRequestT, { clinicianLineTyped = true }: { clinicianLineTyped?: boolean } = {}): Promise<ApiResult<SayItReplyT>> {
      const { body, memoryCode } = withMemory(state, req);
      return callApi('/api/sayit', body, SayItReply, opts(memoryCode, clinicianLineTyped && req.clinicianQuestion ? [req.clinicianQuestion] : []));
    },
    /** Typed: nothing (the recap input is a fixed sample visit). */
    recapCall(state: RumiState, req: RecapRequestT): Promise<ApiResult<RecapReplyT>> {
      const { body, memoryCode } = withMemory(state, req);
      return callApi('/api/recap', body, RecapReply, opts(memoryCode, []));
    },
    /** Typed: the pasted letter or email text. */
    appointmentScanCall(state: RumiState, req: AppointmentScanRequestT): Promise<ApiResult<AppointmentScanReplyT>> {
      const { body, memoryCode } = withMemory(state, req);
      return callApi('/api/appointment/scan', body, AppointmentScanReply, opts(memoryCode, [req.text]));
    },
    /** Typed: nothing. The place is a name the person already confirmed. */
    appointmentLookupCall(state: RumiState, req: LookupRequestT): Promise<ApiResult<LookupReplyT>> {
      const { body, memoryCode } = withMemory(state, req);
      return callApi('/api/appointment/lookup', body, LookupReply, opts(memoryCode, []));
    },
});

export const { planCall, practiceCall, sayItCall, recapCall, appointmentScanCall, appointmentLookupCall } = calls(
  createCallApi({
    fetchFn: (input, init) => fetch(input, init),
    isCrisis,
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  }),
);

/** Longer than the server's own 10 s limit plus a slow network; a voice that late is not worth waiting for. */
const SPEAK_TIMEOUT_MS = 15_000;
/** 600 characters of speech is well under 1 MB of mp3; anything larger is not our server's answer. */
const SPEAK_MAX_BYTES = 5_000_000;

/**
 * Spoken audio for `text` from the server (Cartesia), or null on ANY failure so the screen falls back to the browser
 * voice. Never throws. Play it with `const url = URL.createObjectURL(blob); new Audio(url).play()` and call
 * `URL.revokeObjectURL(url)` when it ends. The text is spoken as given: the crisis check is not run here.
 */
export async function speakCall(
  text: string,
  { fetchFn = (input, init) => fetch(input, init), voice }: { fetchFn?: typeof fetch; voice?: VoiceKey } = {},
): Promise<Blob | null> {
  try {
    const res = await fetchFn('/api/voice/tts', {
      method: 'POST',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(SPEAK_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(voice === undefined ? { text } : { text, voice }),
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('audio/')) return null;
    const blob = await res.blob();
    return blob.size > 0 && blob.size <= SPEAK_MAX_BYTES ? blob : null;
  } catch {
    return null;
  }
}

/** A picture of a letter is at most this big after the browser shrinks it (src/lib/vision/photo.ts PHOTO_BYTES_MAX). */
const PHOTO_MAX_BYTES = 3_000_000;
const PHOTO_TIMEOUT_MS = 30_000;

/**
 * Sends one picture of an appointment letter and gets back the draft fields and the words read from it. Never throws:
 * a failure is {ok:false}. The picture is not kept anywhere on the device or the server.
 */
export async function appointmentPhotoCall(
  photo: Blob,
  { fetchFn = (input, init) => fetch(input, init) }: { fetchFn?: typeof fetch } = {},
): Promise<ApiResult<AppointmentPhotoReplyT>> {
  const fail = (code: 'bad_input' | 'too_large' | 'ai_unavailable' | 'ai_invalid' | 'rate_limited' | 'forbidden'): ApiResult<AppointmentPhotoReplyT> => ({
    ok: false,
    error: { code, message: code === 'too_large' ? 'That picture is too big. Take it again from further away.' : code === 'rate_limited' ? 'There were too many requests. Wait a minute and try again.' : 'Rumi could not read that picture. You can paste or type the details instead.' },
  });
  try {
    if (photo.size > PHOTO_MAX_BYTES) return fail('too_large');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return fail('ai_unavailable');
    const res = await fetchFn('/api/appointment/photo', {
      method: 'POST',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
      headers: { 'Content-Type': photo.type },
      body: photo,
    });
    if (!res.ok) return fail(res.status === 413 ? 'too_large' : res.status === 429 ? 'rate_limited' : res.status === 403 ? 'forbidden' : res.status === 400 ? 'bad_input' : 'ai_unavailable');
    const parsed = AppointmentPhotoReply.safeParse(await res.json());
    return parsed.success ? { ok: true, data: parsed.data } : fail('ai_invalid');
  } catch {
    return fail('ai_unavailable');
  }
}
