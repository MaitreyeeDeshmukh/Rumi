import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyError, isRetryable, mapSupabaseError } from "./mapError";

/**
 * signing_in: checking this browser for a session, or signing in because something asked for it.
 * signed_out: no session, and nobody has asked for one (a visit that uses no cloud feature stays here).
 */
export type AuthStatus = "signing_in" | "signed_out" | "ready" | "degraded" | "offline";

export interface AuthState {
  status: AuthStatus;
  userId: string | null;
  isAnonymous: boolean;
  /** True when this browser signed in as a different person than last time (cookies cleared, session lost). Cloud data under the old identity is out of reach unless it was upgraded with an email. */
  identityReset: boolean;
}

export type UpgradeResult = { ok: true } | { ok: false; message: string };

export type AuthClientLike = {
  auth: Pick<SupabaseClient["auth"], "getSession" | "signInAnonymously" | "onAuthStateChange" | "updateUser">;
  /** Used once after a new sign-in for `core_ensure_my_rows`. Optional: without it that step is skipped. */
  rpc?: SupabaseClient["rpc"];
};

export interface AuthDeps {
  /** Throws when Supabase is not configured; the controller then goes `degraded`. */
  getClient: () => AuthClientLike;
  isOnline: () => boolean;
  /** Calls the handler on every online/offline change. Returns the unsubscribe function. */
  onNetworkChange: (handler: (online: boolean) => void) => () => void;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  /** Milliseconds since 1970. Injected so the cooldowns can be tested. */
  now: () => number;
  /** When this device last asked for an email link. Reading and writing must never throw. */
  emailSentAt: { get: () => number | null; set: (t: number) => void };
  /** The id this browser last signed in as. Reading and writing must never throw. */
  lastUser: { get: () => string | null; set: (id: string) => void };
  /** Turnstile token for the anonymous sign-in, when captcha is on. */
  getCaptchaToken?: () => Promise<string | undefined>;
  /** Where the email link returns to. */
  redirectTo?: () => string;
  /** Called when the one-time `core_ensure_my_rows` call after a new sign-in failed. It is counted and never shown. */
  onEnsureRowsFailed?: () => void;
}

export const MAX_SIGN_IN_TRIES = 3;
/** The shortest time between two manual retries after sign-in failed. */
export const RETRY_COOLDOWN_MS = 60_000;
/** The shortest time between two email-link requests from one device (Auth also limits this project-wide per hour). */
export const EMAIL_COOLDOWN_MS = 60_000;
const BACKOFF_BASE_MS = 500;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/;

export const INITIAL_AUTH_STATE: AuthState = { status: "signing_in", userId: null, isAnonymous: true, identityReset: false };

interface SessionLike {
  user: { id: string; is_anonymous?: boolean };
}

interface Attempt {
  done: Promise<void>;
  /** True when this attempt may create an account. */
  creates: boolean;
}

/**
 * The sign-in state machine, with no React in it: signing_in -> signed_out | ready | degraded | offline.
 * `start()` only looks for a session this browser already has (a local read, no sign-in call), so a person who never uses a
 * cloud feature never creates an account. `ensureSignedIn()` is what a cloud feature calls before it needs a user: it signs
 * in anonymously, and it is safe to call again and again (one sign-in at a time, one answer for every caller).
 * It never throws, never blocks the UI, and never touches the app's own saved state: going `degraded` only means
 * cloud saving is paused. Anonymous sign-in is tried at most MAX_SIGN_IN_TRIES times with jittered backoff, and only
 * for faults worth retrying (network, server, rate limit); a disabled provider or a failed captcha stops at once.
 * After that only `retry()` or a later `ensureSignedIn()` tries again, at most once per RETRY_COOLDOWN_MS.
 */
export function createAuthController(deps: AuthDeps) {
  let state = INITIAL_AUTH_STATE;
  const listeners = new Set<() => void>();
  let current: Attempt | null = null;
  /** True once something asked for an account; from then on a network that comes back signs in. */
  let wanted = false;
  let active = false;
  let lastRetryAt: number | null = null;
  let ensureRowsFailures = 0;

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

  /** Once per new sign-in, not awaited. It heals a profile row the sign-up trigger could not create. A failure is only counted. */
  function ensureRows(client: AuthClientLike): void {
    const count = (): void => {
      ensureRowsFailures += 1;
      try {
        deps.onEnsureRowsFailed?.();
      } catch {
        // A broken counter must not matter.
      }
    };
    try {
      if (client.rpc === undefined) return;
      void Promise.resolve(client.rpc("core_ensure_my_rows")).then((result) => {
        if (result.error) count();
      }, count);
    } catch {
      count();
    }
  }

  /** One pass of the machine. With `create` false it only restores a session that is already here. */
  async function run(create: boolean): Promise<void> {
    try {
      if (!deps.isOnline()) return set({ status: "offline" });
      set({ status: "signing_in" });
      const client = deps.getClient();
      // A session already in this browser (cookie) wins; it is read locally and refreshed by supabase-js when needed.
      const existing = await client.auth.getSession();
      if (existing.data.session) return applySession(existing.data.session);
      if (!create) return set({ status: "signed_out" });
      for (let attempt = 1; attempt <= MAX_SIGN_IN_TRIES; attempt++) {
        const captchaToken = await deps.getCaptchaToken?.();
        const { data, error } = await client.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
        if (!error && data.session) {
          applySession(data.session);
          return ensureRows(client);
        }
        if (error && (!isRetryable(classifyError(error)) || attempt === MAX_SIGN_IN_TRIES)) return failed();
        if (!deps.isOnline()) return set({ status: "offline" });
        await deps.sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1) * (0.5 + deps.random() / 2));
      }
      failed();
    } catch {
      // supabase-js reports faults as values; a throw here means a missing configuration or a network layer fault.
      // Either way the person keeps working on this device: the failure is shown as a status, not an error.
      failed();
    }
  }

  /** One attempt at a time. A caller that wants an account while a restore is running waits for it, then signs in if still needed. */
  function attempt(create: boolean): Promise<void> {
    if (current !== null) {
      const running = current;
      if (!create || running.creates) return running.done;
      return running.done.then(() => (state.status === "ready" ? undefined : attempt(true)));
    }
    const mine: Attempt = { creates: create, done: Promise.resolve() };
    mine.done = run(create).finally(() => {
      current = null;
    });
    current = mine;
    return mine.done;
  }

  /** The manual-retry rule: only from degraded or offline, never while an attempt runs, at most one per RETRY_COOLDOWN_MS. */
  function mayRetry(): boolean {
    if (current !== null || (state.status !== "degraded" && state.status !== "offline")) return false;
    const t = deps.now();
    if (lastRetryAt !== null && t >= lastRetryAt && t - lastRetryAt < RETRY_COOLDOWN_MS) return false;
    lastRetryAt = t;
    return true;
  }

  return {
    getState: (): AuthState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Starts listening and restores a session this browser already has. It never signs in. Returns the stop function. Safe to call again after stopping (React strict mode). */
    start(): () => void {
      active = true;
      const stops: Array<() => void> = [];
      try {
        const { data } = deps.getClient().auth.onAuthStateChange((event, session) => {
          if (!active) return;
          if (session && event !== "SIGNED_OUT") applySession(session);
          // Our own sign-in clears a dead session first, which emits SIGNED_OUT; that is not the end of the story.
          else if (event === "SIGNED_OUT" && current === null) set({ status: "degraded", userId: null });
        });
        stops.push(() => data.subscription.unsubscribe());
      } catch {
        // Not configured: the first attempt hits the same fault and reports `degraded`.
      }
      stops.push(
        deps.onNetworkChange((online) => {
          if (!active) return;
          if (!online) return set({ status: "offline" });
          if (state.status !== "offline") return;
          if (state.userId !== null) set({ status: "ready" });
          else void attempt(wanted);
        }),
      );
      void attempt(wanted);
      return () => {
        active = false;
        for (const stop of stops) stop();
      };
    },
    /**
     * Manual retry after `degraded` or `offline`. Does nothing while a sign-in is running or when ready, and at most
     * one retry is accepted per RETRY_COOLDOWN_MS, so a button pressed again and again cannot hammer Auth.
     */
    retry(): void {
      if (mayRetry()) {
        wanted = true;
        void attempt(true);
      }
    },
    /**
     * Makes sure there is a signed-in user before a cloud feature runs, and answers with the state afterwards (check
     * `status === "ready"`). Safe to call many times: it does nothing when ready, shares one sign-in between callers, and
     * after a failure it is held to the same cooldown as `retry()`. Never throws.
     */
    async ensureSignedIn(): Promise<AuthState> {
      wanted = true;
      if (state.status === "ready") return state;
      if (current !== null) await attempt(true);
      else if (state.status === "degraded" || state.status === "offline") {
        if (mayRetry()) await attempt(true);
      } else await attempt(true);
      return state;
    },
    /** How many one-time row checks failed after a sign-in. For tests and diagnostics; no user data. */
    ensureRowsFailures: (): number => ensureRowsFailures,
    async upgradeWithEmail(email: string): Promise<UpgradeResult> {
      const address = email.trim();
      if (address.length > 254 || !EMAIL_RE.test(address)) return { ok: false, message: "That email address does not look right." };
      if (state.status !== "ready" || state.userId === null) return { ok: false, message: "Saving is paused, so email sign-in is not available yet." };
      if (!state.isAnonymous) return { ok: false, message: "This device already has an email." };
      const t = deps.now();
      const last = deps.emailSentAt.get();
      if (last !== null && t >= last && t - last < EMAIL_COOLDOWN_MS) return { ok: false, message: "A link was just asked for, so wait one minute before asking again." };
      // Recorded before the call, so a double click cannot send two.
      deps.emailSentAt.set(t);
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
