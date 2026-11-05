/** Every outbound Supabase call from the server has a deadline (08 section 4.1). A caller's own signal still wins. */
const SERVER_TIMEOUT_MS = 3000;

export const fetchWithTimeout: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(SERVER_TIMEOUT_MS) });
