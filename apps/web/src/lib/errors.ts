// stub for lane merge: owned by prod-observability (frozen signatures, addendum section 3). Delete this file at merge.
export type AppErrorCode =
  | 'bad_input' | 'too_large' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict'
  | 'rate_limited' | 'ai_invalid' | 'ai_unavailable' | 'store_unavailable' | 'config' | 'internal';

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    readonly status: number = 400,
    readonly expose: boolean = true,
  ) {
    super(code);
  }
}

export function toResponse(err: unknown, requestId: string): Response {
  const e = err instanceof AppError ? err : new AppError('internal', 500);
  return Response.json({ error: { code: e.code, message: e.code, requestId } }, { status: e.status, headers: { 'Cache-Control': 'no-store' } });
}

export function fingerprintOf(err: unknown): string {
  return err instanceof AppError ? err.code.padEnd(16, '0').slice(0, 16) : '0000000000000000';
}
