import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyError, isRetryable, mapSupabaseError } from "./mapError";

export type AuthStatus = "signing_in" | "ready" | "degraded" | "offline";

export interface AuthState {
  status: AuthStatus;
  userId: string | null;
  isAnonymous: boolean;
  /** True when this browser signed in as a different person than last time (cookies cleared, session lost). Cloud data under the old identity is out of reach unless it was upgraded with an email. */
  identityReset: boolean;
}

export type UpgradeResult = { ok: true } | { ok: false; message: string };

export type AuthClientLike = { auth: Pick<SupabaseClient["auth"], "getSession" | "signInAnonymously" | "onAuthStateChange" | "updateUser"> };

export interface AuthDeps {
  /** Throws when Supabase is not configured; the controller then goes `degraded`. */
  getClient: () => AuthClientLike;
  isOnline: () => boolean;
  /** Calls the handler on every online/offline change. Returns the unsubscribe function. */
  onNetworkChange: (handler: (online: boolean) => void) => () => void;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  /** The id this browser last signed in as. Reading and writing must never throw. */
  lastUser: { get: () => string | null; set: (id: string) => void };
  /** Turnstile token for the anonymous sign-in, when captcha is on. */
  getCaptchaToken?: () => Promise<string | undefined>;
  /** Where the email link returns to. */
  redirectTo?: () => string;
}

export const MAX_SIGN_IN_TRIES = 3;
const BACKOFF_BASE_MS = 500;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/;

export const INITIAL_AUTH_STATE: AuthState = { status: "signing_in", userId: null, isAnonymous: true, identityReset: false };

interface SessionLike {
  user: { id: string; is_anonymous?: boolean };
}

/**
 * The sign-in state machine, with no React in it: signing_in -> ready | degraded | offline.
 * It never throws, never blocks the UI, and never touches the app's own saved state: going `degraded` only means
 * cloud saving is paused. Anonymous sign-in is tried at most MAX_SIGN_IN_TRIES times with jittered backoff, and only
 * for faults worth retrying (network, server, rate limit); a disabled provider or a failed captcha stops at once.
 * After that only `retry()` tries again.
 */
export function createAuthController(deps: AuthDeps) {
  let state = INITIAL_AUTH_STATE;
  const listeners = new Set<() => void>();
  let running = false;
  let active = false;

  const set = (patch: Partial<AuthState>): void => {
    const next = { ...state, ...patch };
    if (next.status === state.status && next.userId === state.userId && next.isAnonymous === state.isAnonymous && next.identityReset === state.identityReset) return;
    state = next;
    for (const l of [...listeners]) l();
  };

  const applySession = (session: SessionLike): void => {
    const previous = deps.lastUser.get();
    deps.lastUser.set(session.user.id);
    set({
      status: "ready",
      userId: session.user.id,
      isAnonymous: session.user.is_anonymous === true,
      identityReset: state.identityReset || (previous !== null && previous !== session.user.id),
    });
  };

  const failed = (): void => set({ status: deps.isOnline() ? "degraded" : "offline" });

  async function signIn(): Promise<void> {
    if (running) return;
    running = true;
    try {
      if (!deps.isOnline()) return set({ status: "offline" });
      set({ status: "signing_in" });
      const client = deps.getClient();
      // A session already in this browser (cookie) wins; it is read locally and refreshed by supabase-js when needed.
      const existing = await client.auth.getSession();
      if (existing.data.session) return applySession(existing.data.session);
      for (let attempt = 1; attempt <= MAX_SIGN_IN_TRIES; attempt++) {
        const captchaToken = await deps.getCaptchaToken?.();
        const { data, error } = await client.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
        if (!error && data.session) return applySession(data.session);
        if (error && (!isRetryable(classifyError(error)) || attempt === MAX_SIGN_IN_TRIES)) return failed();
        if (!deps.isOnline()) return set({ status: "offline" });
        await deps.sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1) * (0.5 + deps.random() / 2));
      }
      failed();
    } catch {
      // supabase-js reports faults as values; a throw here means a missing configuration or a network layer fault.
      // Either way the person keeps working on this device: the failure is shown as a status, not an error.
      failed();
    } finally {
      running = false;
    }
  }

  return {
    getState: (): AuthState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Starts listening and signs in. Returns the stop function. Safe to call again after stopping (React strict mode). */
    start(): () => void {
      active = true;
      const stops: Array<() => void> = [];
      try {
        const { data } = deps.getClient().auth.onAuthStateChange((event, session) => {
          if (!active) return;
          if (session && event !== "SIGNED_OUT") applySession(session);
          // Our own sign-in clears a dead session first, which emits SIGNED_OUT; that is not the end of the story.
          else if (event === "SIGNED_OUT" && !running) set({ status: "degraded", userId: null });
        });
        stops.push(() => data.subscription.unsubscribe());
      } catch {
        // Not configured: signIn() hits the same fault and reports `degraded`.
      }
      stops.push(
        deps.onNetworkChange((online) => {
          if (!active) return;
          if (!online) return set({ status: "offline" });
          if (state.status !== "offline") return;
          if (state.userId !== null) set({ status: "ready" });
          else void signIn();
        }),
      );
      void signIn();
      return () => {
        active = false;
        for (const stop of stops) stop();
      };
    },
    /** Manual retry after `degraded` or `offline`. Does nothing while a sign-in is running or when ready. */
    retry(): void {
      if (state.status === "degraded" || state.status === "offline") void signIn();
    },
    async upgradeWithEmail(email: string): Promise<UpgradeResult> {
      const address = email.trim();
      if (address.length > 254 || !EMAIL_RE.test(address)) return { ok: false, message: "That email address does not look right." };
      if (state.status !== "ready" || state.userId === null) return { ok: false, message: "Saving is paused, so email sign-in is not available yet." };
      if (!state.isAnonymous) return { ok: false, message: "This device already has an email." };
      try {
        const { error } = await deps.getClient().auth.updateUser({ email: address }, deps.redirectTo ? { emailRedirectTo: deps.redirectTo() } : undefined);
        if (!error) return { ok: true };
        // An address that already belongs to someone looks exactly like success, so the form cannot be used to find out who has an account.
        if (classifyError(error) === "email_exists") return { ok: true };
        return { ok: false, message: mapSupabaseError(error).message };
      } catch (e) {
        return { ok: false, message: mapSupabaseError(e).message };
      }
    },
  };
}
