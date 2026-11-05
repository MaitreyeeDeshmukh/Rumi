/** Request ids: proxy.ts sets one per request, every response echoes it, every log line and error body carries it. */
export const REQUEST_ID_HEADER = "x-request-id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const newRequestId = (): string => crypto.randomUUID();

/** The id the proxy set, or a new one. A caller-supplied value that is not a uuid is never trusted into a log line. */
export function requestIdOf(req: Request): string {
  const sent = req.headers.get(REQUEST_ID_HEADER);
  return sent !== null && UUID_RE.test(sent) ? sent : newRequestId();
}
