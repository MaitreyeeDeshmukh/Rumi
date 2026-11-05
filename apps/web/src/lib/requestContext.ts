/** One id per request. proxy.ts creates it, route handlers read it, every response echoes it. */
export const REQUEST_ID_HEADER = "x-request-id";

export const newRequestId = (): string => crypto.randomUUID();

/** UUID shape only. A client-sent value of any other shape (long, with spaces or newlines) is never copied into a log or a response. */
const ID_SHAPE = /^[0-9a-fA-F-]{36}$/;

/** The id proxy.ts put on the request; a fresh one when it is missing or not shaped like a uuid (tests, direct calls, forged headers). */
export function requestIdOf(req: Request): string {
  const sent = req.headers.get(REQUEST_ID_HEADER);
  return sent !== null && ID_SHAPE.test(sent) ? sent : newRequestId();
}
