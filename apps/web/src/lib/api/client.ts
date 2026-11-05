/**
 * Browser side of the four AI routes. Built by a factory so the crisis check, fetch and the online flag are
 * injected (the crisis function belongs to the harness lane; the default wiring happens in Phase 2).
 * It never throws: every failure becomes an ApiResult with fixed, friendly wording.
 */
import type { z } from 'zod';
import { isRecoveryCode } from '@/features/memory/recoveryCode';
import type { ApiErrorCode, ApiResult } from '@/features/shared/types';

export type ApiPath = '/api/plan' | '/api/practice' | '/api/sayit' | '/api/recap';

export interface CallApiDeps {
  fetchFn: typeof fetch;
  /** Best-effort layer 1. The server check is the gate. */
  isCrisis: (text: string) => boolean;
  isOnline: () => boolean;
  timeoutMs?: number;
}

export interface CallOpts {
  /** Sent as x-rumi-key only when it is a valid recovery code. */
  memoryCode?: string;
  /** The strings the person typed in this request. When given, only these get the crisis check
   *  (a clinician turn or a stored plan item that mentions a symptom must not look like a crisis). */
  typedText?: readonly string[];
}

const API_TIMEOUT_MS = 25_000;
const MAX_DEPTH = 12;

const MESSAGES: Record<ApiErrorCode, string> = {
  bad_input: 'Something in your text could not be sent. Check it and try again.',
  too_large: 'That is too long. Make it shorter and try again.',
  forbidden: 'This request was not allowed. Reload the page and try again.',
  ai_invalid: 'I could not make a safe answer. Your work is saved. Try again.',
  ai_unavailable: 'I could not reach the AI. Your work is saved. Try again.',
  rate_limited: 'There were too many requests. Wait a minute and try again.',
};
const CODES = Object.keys(MESSAGES) as ApiErrorCode[];
const STATUS_CODE = new Map<number, ApiErrorCode>([
  [400, 'bad_input'],
  [403, 'forbidden'],
  [413, 'too_large'],
  [429, 'rate_limited'],
]);

const fail = (code: ApiErrorCode): ApiResult<never> => ({ ok: false, error: { code, message: MESSAGES[code] } });

function collectStrings(v: unknown, out: string[] = [], seen = new WeakSet<object>(), depth = 0): string[] {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'object' && v !== null && depth < MAX_DEPTH && !seen.has(v)) {
    seen.add(v);
    for (const x of Object.values(v)) collectStrings(x, out, seen, depth + 1);
  }
  return out;
}

const errorCode = (status: number, data: unknown): ApiErrorCode => {
  const code = (data as { error?: { code?: unknown } } | null)?.error?.code;
  const known = CODES.find((c) => c === code);
  return known ?? STATUS_CODE.get(status) ?? 'ai_unavailable';
};

export function createCallApi({ fetchFn, isCrisis, isOnline, timeoutMs = API_TIMEOUT_MS }: CallApiDeps) {
  const hit = (text: string): boolean => {
    try {
      return isCrisis(text);
    } catch {
      return false; // the server runs the same check and decides
    }
  };

  return async function callApi<Reply>(path: ApiPath, body: unknown, reply: z.ZodType<Reply>, opts: CallOpts = {}): Promise<ApiResult<Reply>> {
    try {
      if ((opts.typedText ?? collectStrings(body)).some(hit)) return { ok: false, crisis: true };
      if (!isOnline()) return fail('ai_unavailable');

      let payload: string;
      try {
        payload = JSON.stringify(body);
      } catch {
        return fail('bad_input');
      }

      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetchFn(path, {
          method: 'POST',
          credentials: 'same-origin',
          signal: ctl.signal,
          headers: {
            'Content-Type': 'application/json',
            ...(opts.memoryCode !== undefined && isRecoveryCode(opts.memoryCode) ? { 'x-rumi-key': opts.memoryCode } : {}),
          },
          body: payload,
        });
        const data: unknown = await res.json().catch(() => null);
        if (typeof data === 'object' && data !== null && (data as { crisis?: unknown }).crisis === true) return { ok: false, crisis: true };
        if (!res.ok) return fail(errorCode(res.status, data));
        const parsed = reply.safeParse(data);
        return parsed.success ? { ok: true, data: parsed.data } : fail('ai_invalid');
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return fail('ai_unavailable');
    }
  };
}
