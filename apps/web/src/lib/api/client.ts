import type { z } from 'zod';
import type { ApiErrorCode, ApiResult } from '@/features/shared/types';

export type ApiPath = '/api/plan' | '/api/practice' | '/api/sayit' | '/api/recap';
export type CallApi = <Req, Reply>(
  path: ApiPath, body: Req, reply: z.ZodType<Reply>, opts?: { memoryCode?: string },
) => Promise<ApiResult<Reply>>;

export const TIMEOUT_MS = 20_000;
export const OFFLINE = 'I could not reach the AI. Your work is saved. Try again.';
export const INVALID = 'I could not make a safe answer. Your work is saved. Try again.';

const CODES: readonly ApiErrorCode[] = ['bad_input', 'too_large', 'forbidden', 'ai_invalid', 'ai_unavailable', 'rate_limited'];

/** Every string anywhere inside v (nested objects and arrays), so crisis text in any field is found. */
export const allStrings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => allStrings(x, out));
  return out;
};

const err = (code: ApiErrorCode, message: string): ApiResult<never> => ({ ok: false, error: { code, message } });

/** Reads the server error body without trusting it: unknown codes and non-string messages fall back to safe defaults. */
function serverError(data: unknown): ApiResult<never> {
  const e = data && typeof data === 'object' ? (data as { error?: unknown }).error : undefined;
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  const message = e && typeof e === 'object' ? (e as { message?: unknown }).message : undefined;
  return err(
    CODES.includes(code as ApiErrorCode) ? (code as ApiErrorCode) : 'ai_unavailable',
    typeof message === 'string' && message.length > 0 && message.length <= 300 ? message : OFFLINE,
  );
}

/**
 * Builds callApi around the crisis check, so the client can be tested with a fake one.
 * Order: crisis check on every string in the body (layer 1, no network) -> offline -> POST with a
 * 20 s timeout -> crisis reply -> error reply -> validate the reply shape (never trust the server either).
 */
export function createCallApi(isCrisis: (text: string) => boolean): CallApi {
  return async function callApi<Req, Reply>(
    path: ApiPath, body: Req, reply: z.ZodType<Reply>, opts?: { memoryCode?: string },
  ): Promise<ApiResult<Reply>> {
    if (allStrings(body).some((s) => isCrisis(s))) return { ok: false, crisis: true };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return err('ai_unavailable', OFFLINE);

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(path, {
        method: 'POST', credentials: 'same-origin', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', ...(opts?.memoryCode ? { 'x-rumi-key': opts.memoryCode } : {}) },
        body: JSON.stringify(body),
      });
      const data: unknown = await res.json().catch(() => null);
      if (data && typeof data === 'object' && (data as { crisis?: unknown }).crisis === true) return { ok: false, crisis: true };
      if (!res.ok) return serverError(data);
      const parsed = reply.safeParse(data);
      return parsed.success ? { ok: true, data: parsed.data } : err('ai_invalid', INVALID);
    } catch {
      return err('ai_unavailable', OFFLINE); // network error or timeout
    } finally {
      clearTimeout(timer);
    }
  };
}
