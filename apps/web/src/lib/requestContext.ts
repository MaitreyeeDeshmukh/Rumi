/** One id per request. proxy.ts creates it, route handlers read it, every response echoes it. */
export const REQUEST_ID_HEADER = "x-request-id";

export const newRequestId = (): string => crypto.randomUUID();

/** The id proxy.ts put on the request; a fresh one when the route is reached some other way (tests, direct calls). */
export const requestIdOf = (req: Request): string => req.headers.get(REQUEST_ID_HEADER) ?? newRequestId();
