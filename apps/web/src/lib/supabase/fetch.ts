/** Every outbound Supabase call from the server has a deadline (08 section 4.1). A caller's own signal still wins. */
const SERVER_TIMEOUT_MS = 3000;
/** Admin calls (delete user, erasure checks) may take longer than a page request, so they get a longer deadline. */
export const ADMIN_TIMEOUT_MS = 10_000;

export const timeoutFetch =
  (ms: number): typeof fetch =>
  (input, init) =>
    fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(ms) });

export const fetchWithTimeout: typeof fetch = timeoutFetch(SERVER_TIMEOUT_MS);
