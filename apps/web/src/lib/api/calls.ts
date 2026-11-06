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
import { memoryCodeFor } from '@/features/memory/actions';
import { toWireFacts } from '@/features/memory/persona';
import {
  PlanReply,
  PracticeReply,
  RecapReply,
  SayItReply,
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

/** Only the facts the person stated may reach a prompt (support_pref, pacing). help_level is used by code, never by the model. */
const STATED = new Set(['support_pref', 'pacing']);

/** The body plus, while memory is on, the stated persona facts (kind and key only: a fact has no free text). */
function withMemory<T extends object>(state: RumiState, body: T): { body: T & { facts?: ReturnType<typeof toWireFacts> }; memoryCode?: string } {
  const memoryCode = memoryCodeFor(state);
  if (memoryCode === undefined) return { body };
  const facts = toWireFacts(state.persona.facts.filter((f) => STATED.has(f.kind)));
  return { body: facts.length > 0 ? { ...body, facts } : body, memoryCode };
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
});

export const { planCall, practiceCall, sayItCall, recapCall } = calls(
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
export async function speakCall(text: string, { fetchFn = (input, init) => fetch(input, init) }: { fetchFn?: typeof fetch } = {}): Promise<Blob | null> {
  try {
    const res = await fetchFn('/api/voice/tts', {
      method: 'POST',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(SPEAK_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('audio/')) return null;
    const blob = await res.blob();
    return blob.size > 0 && blob.size <= SPEAK_MAX_BYTES ? blob : null;
  } catch {
    return null;
  }
}
