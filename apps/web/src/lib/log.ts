// stub for lane merge: owned by prod-observability (frozen signatures, addendum section 3). Delete this file at merge.
export type Fields = Record<string, string | number | boolean | undefined>;
export interface Logger {
  info(event: string, f?: Fields): void;
  warn(event: string, f?: Fields): void;
  error(event: string, err: unknown, f?: Fields): void;
}

export function createLogger(ctx: { requestId: string; route: string }): Logger {
  const line = (level: string, event: string, f?: Fields): void => console.log(JSON.stringify({ level, event, ...ctx, ...f }));
  return {
    info: (event, f) => line('info', event, f),
    warn: (event, f) => line('warn', event, f),
    error: (event, _err, f) => line('error', event, f),
  };
}
