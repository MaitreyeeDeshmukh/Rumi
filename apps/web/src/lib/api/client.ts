/**
 * Browser side of the four AI routes. Built by a factory so the crisis check, fetch and the online flag are
 * injected (the crisis function belongs to the harness lane; the default wiring happens in Phase 2).
 * It never throws: every failure becomes an ApiResult with fixed, friendly wording.
 */
import type { z } from 'zod';
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
  /** The strings the person typed in this request. When non-empty, only these get the crisis check
   *  (a clinician turn or a stored plan item that mentions a symptom must not look like a crisis).
   *  An empty list does NOT switch the check off: it falls back to checking the whole body. */
  typedText?: readonly string[];
  /** The one way to skip the client check, for a request that carries no typed text (the recap of a sample visit).
   *  The server still runs its own check; this layer is best effort. */
  skipCrisisCheck?: boolean;
  /**
   * One id per user action. A caller that repeats the same action (a "Try again" after a timeout) passes the id it got the
   * first time, so the server treats the repeat as the same request and shares the work. Without it each call is a new action.
   */
  idempotencyKey?: string;
}

/** The header the harness reads (8 to 64 letters, digits, underscore, hyphen). */
export const IDEMPOTENCY_HEADER = 'x-idempotency-key';
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** A fresh id for one user action. Undefined when the browser has no crypto.randomUUID (an insecure page): the header is then left out. */
export function newIdempotencyKey(): string | undefined {
  try {
    return crypto.randomUUID();
  } catch {
    return undefined;
  }
}

const API_TIMEOUT_MS = 25_000;
/** Nesting deeper than this is refused as bad input, so crisis text cannot hide below the depth we look at. */
const MAX_DEPTH = 32;
/** A reply larger than this is not an answer from our server. */
const MAX_REPLY_BYTES = 1_000_000;

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

/** Every string in the body. `tooDeep` is set when something nests below MAX_DEPTH. */
// Known limit: only own enumerable string values are seen. Text produced by a toJSON() is not, so the server
// check (the real gate) is what catches it.
function collectStrings(v: unknown, acc = { strings: [] as string[], tooDeep: false }, seen = new WeakSet<object>(), depth = 0) {
  if (typeof v === 'string') acc.strings.push(v);
  else if (typeof v === 'object' && v !== null && !seen.has(v)) {
    if (depth >= MAX_DEPTH) acc.tooDeep = true;
    else {
      seen.add(v);
      for (const x of Object.values(v)) collectStrings(x, acc, seen, depth + 1);
    }
  }
  return acc;
}

/** Reads at most `max` bytes of the body. Null means it was larger. */
async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) {
    const text = await res.text();
    return text.length > max ? null : text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
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
      const found = collectStrings(body);
      if (found.tooDeep) return fail('bad_input');
      if (!opts.skipCrisisCheck && (opts.typedText?.length ? opts.typedText : found.strings).some(hit)) return { ok: false, crisis: true };
      if (!isOnline()) return fail('ai_unavailable');

      let payload: string;
      try {
        payload = JSON.stringify(body);
      } catch {
        return fail('bad_input');
      }

      const key = opts.idempotencyKey !== undefined && IDEMPOTENCY_RE.test(opts.idempotencyKey) ? opts.idempotencyKey : newIdempotencyKey();
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetchFn(path, {
          method: 'POST',
          credentials: 'same-origin',
          signal: ctl.signal,
          headers: key === undefined ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: key },
          body: payload,
        });
        const text = await readCapped(res, MAX_REPLY_BYTES);
        let data: unknown = null;
        try {
          data = text === null ? null : JSON.parse(text);
        } catch {
          data = null; // not JSON: handled below as a bad reply or an error status
        }
        if (typeof data === 'object' && data !== null && (data as { crisis?: unknown }).crisis === true) return { ok: false, crisis: true };
        if (!res.ok) return fail(errorCode(res.status, data));
        if (text === null) return fail('ai_invalid');
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
