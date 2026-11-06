import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyError, isRetryable, type ErrorKind, mapAuthFormError, mapSupabaseError } from "./mapError";

/**
 * signing_in: checking this browser for a session, or signing in because something asked for it.
 * signed_out: no session, and nobody has asked for one (a visit that uses no cloud feature stays here).
 */
export type AuthStatus = "signing_in" | "signed_out" | "ready" | "degraded" | "offline";

export interface AuthState {
  status: AuthStatus;
  userId: string | null;
  isAnonymous: boolean;
  /** The address of the signed-in account, or null for a guest or nobody. */
  email: string | null;
  /** True when this browser signed in as a different person than last time (cookies cleared, session lost). Cloud data under the old identity is out of reach unless it was upgraded with an email. */
  identityReset: boolean;
}

type UpgradeFailure = { ok: false; message: string };
export type UpgradeResult = { ok: true } | UpgradeFailure;
/** `needsConfirmation`: the account exists only once the person types the code from their email. The text is the same whether or not the address was already in use. */
export type AuthResult = { ok: true; needsConfirmation: boolean } | { ok: false; message: string; unconfirmed?: true };

export type AuthClientLike = {
  auth: Pick<SupabaseClient["auth"], "getSession" | "signInAnonymously" | "onAuthStateChange" | "updateUser" | "signUp" | "signInWithPassword" | "signOut" | "verifyOtp" | "resend" | "resetPasswordForEmail">;
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
  /** False when sign-up is required: nobody is ever signed in anonymously. Default true (the demo escape hatch). */
  allowAnonymous?: () => boolean;
  /** Clears what only this browser remembers about the last account (the last user id and the email cooldown). Never throws. */
  forgetDevice?: () => void;
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

export const MIN_PASSWORD_LENGTH = 8;
/** Auth hashes only the first 72 characters, so a longer password would silently be cut. */
export const MAX_PASSWORD_LENGTH = 72;

export const INITIAL_AUTH_STATE: AuthState = { status: "signing_in", userId: null, isAnonymous: true, email: null, identityReset: false };

/** Sentences the controller itself returns. One literal sentence each, 15 words or fewer (checked by a test). */
export const AUTH_MESSAGES = {
  emailEmpty: "Enter your email.",
  emailInvalid: "That email address does not look right.",
  passwordEmpty: "Enter your password.",
  cooldown: "A code was just sent, so wait one minute before asking again.",
  noResetSession: "That reset did not finish, so ask for a new code.",
  codeInvalid: "Enter the 6 digits from your email.",
  codeWrong: "That code is wrong or too old, so ask for a new one.",
} as const;

export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();
export const CODE_LENGTH = 6;
/** Faults that say something other than "the code is wrong": the network, a limit. Every other answer to a code is the one wrong-or-old sentence. */
const CODE_FAULTS: ReadonlySet<ErrorKind> = new Set<ErrorKind>(["network", "server", "rate_limited", "email_rate_limited", "captcha"]);
/** Keeps only the digits, so a code pasted as "123 456" or "123-456" still works. */
export const cleanCode = (raw: string): string => raw.replace(/\D/g, "");
export const isValidCode = (code: string): boolean => code.length === CODE_LENGTH;
export const isValidEmail = (address: string): boolean => address.length <= 254 && EMAIL_RE.test(address);

export interface CredentialErrors {
  email: string | null;
  password: string | null;
}

/** The checks a log-in or sign-up form makes before it calls Auth. Log-in only needs a password; sign-up enforces the length. Null means fine. */
export function checkCredentials(rawEmail: string, password: string, mode: "login" | "signup"): CredentialErrors {
  const address = normalizeEmail(rawEmail);
  let passwordError: string | null = null;
  if (password.length === 0) passwordError = AUTH_MESSAGES.passwordEmpty;
  else if (mode === "signup" && password.length < MIN_PASSWORD_LENGTH) passwordError = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  else if (mode === "signup" && password.length > MAX_PASSWORD_LENGTH) passwordError = `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  return {
    email: address.length === 0 ? AUTH_MESSAGES.emailEmpty : isValidEmail(address) ? null : AUTH_MESSAGES.emailInvalid,
    password: passwordError,
  };
}

interface SessionLike {
  user: { id: string; is_anonymous?: boolean; email?: string };
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
  /** Above zero while this controller itself logs in, signs up or signs out. The events those calls cause are not "another person signed in" and not "the session was lost". */
  let intentional = 0;

  const set = (patch: Partial<AuthState>): void => {
    const next = { ...state, ...patch };
    if (next.status === state.status && next.userId === state.userId && next.isAnonymous === state.isAnonymous && next.email === state.email && next.identityReset === state.identityReset) return;
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
      email: session.user.email || null,
      identityReset: state.identityReset || (intentional === 0 && previous !== null && previous !== session.user.id),
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

  /** Runs a call that changes who is signed in. A restore that is still running finishes first, so it cannot overwrite the answer afterwards. */
  async function intentionally<T>(fn: (client: AuthClientLike) => Promise<T>): Promise<T> {
    if (current !== null) await current.done;
    intentional += 1;
    try {
      return await fn(deps.getClient());
    } finally {
      intentional -= 1;
    }
  }

  /** A sentence when this device asked for an email link less than a minute ago, else null. */
  const emailCooldownMessage = (): string | null => {
    const t = deps.now();
    const last = deps.emailSentAt.get();
    return last !== null && t >= last && t - last < EMAIL_COOLDOWN_MS ? AUTH_MESSAGES.cooldown : null;
  };

  /** The checks and the shared failure handling of log-in and sign-up. Never throws. */
  async function credentialCall(rawEmail: string, password: string, mode: "login" | "signup", call: (client: AuthClientLike, email: string) => Promise<AuthResult>): Promise<AuthResult> {
    const email = normalizeEmail(rawEmail);
    const bad = checkCredentials(email, password, mode);
    const invalid = bad.email ?? bad.password;
    if (invalid !== null) return { ok: false, message: invalid };
    try {
      return await intentionally((client) => call(client, email));
    } catch (e) {
      // supabase-js reports faults as values; a throw is a missing configuration or a network layer fault. No retry: the person presses the button again.
      return { ok: false, message: mapAuthFormError(e) };
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
      if (!create || deps.allowAnonymous?.() === false) return set({ status: "signed_out" });
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

  /** The checks before any email link is requested: the address, then the one-minute cooldown (recorded at once, so a double click cannot send two). */
  function askForLink(email: string, otherChecks?: () => UpgradeFailure | null): string | UpgradeFailure {
    const address = email.trim();
    if (address.length > 254 || !EMAIL_RE.test(address)) return { ok: false, message: "That email address does not look right." };
    const refused = otherChecks?.();
    if (refused) return refused;
    const t = deps.now();
    const last = deps.emailSentAt.get();
    if (last !== null && t >= last && t - last < EMAIL_COOLDOWN_MS) return { ok: false, message: "A link was just asked for, so wait one minute before asking again." };
    deps.emailSentAt.set(t);
    return address;
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
          else if (event === "SIGNED_OUT" && current === null && intentional === 0) set({ status: "degraded", userId: null });
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
      // Sign-up required: there is nothing to create here (the sign-in page does it), so answer at once and change nothing.
      if (deps.allowAnonymous?.() === false) return state;
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
    /**
     * Makes an account with an email and a password, and has Auth email a 6-digit code. A guest (anonymous session, demo mode only)
     * keeps its data: the email and password are added to the same user. Anybody else gets a new account. Either way the account
     * is confirmed by `verifyEmailCode`. The password goes to Auth only: it is never stored or logged.
     */
    signUpWithPassword(rawEmail: string, password: string): Promise<AuthResult> {
      return credentialCall(rawEmail, password, "signup", async (client, email) => {
        const existing = await client.auth.getSession();
        if (existing.data.session?.user.is_anonymous === true) {
          const { data, error } = await client.auth.updateUser({ email, password });
          if (error) return { ok: false, message: mapAuthFormError(error) };
          // With email confirmation on, the address is only pending, so the user stays a guest until the code is typed.
          const pending = data.user?.is_anonymous === true;
          if (data.user && !pending) applySession({ user: data.user });
          if (pending) deps.emailSentAt.set(deps.now());
          return { ok: true, needsConfirmation: pending };
        }
        const { data, error } = await client.auth.signUp({ email, password });
        if (error) return { ok: false, message: mapAuthFormError(error) };
        // No session means the code must be typed first. An address that already has an account looks the same (Auth hides it), so this reply never says which.
        if (!data.session) {
          deps.emailSentAt.set(deps.now());
          return { ok: true, needsConfirmation: true };
        }
        applySession(data.session);
        ensureRows(client);
        return { ok: true, needsConfirmation: false };
      });
    },
    /**
     * Checks the 6-digit code from the email. "signup": confirms the new account and signs the person in. "recovery": the code
     * from a password-reset email, which signs the person in so `updatePassword` can follow. A wrong or old code gets one sentence
     * that never says why. Never throws.
     */
    async verifyEmailCode(rawEmail: string, rawCode: string, purpose: "signup" | "recovery"): Promise<UpgradeResult> {
      const email = normalizeEmail(rawEmail);
      if (!isValidEmail(email)) return { ok: false, message: AUTH_MESSAGES.emailInvalid };
      const token = cleanCode(rawCode);
      if (!isValidCode(token)) return { ok: false, message: AUTH_MESSAGES.codeInvalid };
      try {
        return await intentionally(async (client) => {
          const guest = purpose === "signup" && (await client.auth.getSession()).data.session?.user.is_anonymous === true;
          const { data, error } = await client.auth.verifyOtp({ email, token, type: purpose === "recovery" ? "recovery" : guest ? "email_change" : "signup" });
          if (error) return { ok: false, message: CODE_FAULTS.has(classifyError(error)) ? mapAuthFormError(error) : AUTH_MESSAGES.codeWrong };
          if (!data.session) return { ok: false, message: AUTH_MESSAGES.codeWrong };
          applySession(data.session);
          ensureRows(client);
          return { ok: true };
        });
      } catch (e) {
        return { ok: false, message: mapAuthFormError(e) };
      }
    },
    /** Logs in with an email and a password. One try per call and no retry. */
    signInWithPassword(rawEmail: string, password: string): Promise<AuthResult> {
      return credentialCall(rawEmail, password, "login", async (client, email) => {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) return classifyError(error) === "email_not_confirmed" ? { ok: false, message: mapAuthFormError(error), unconfirmed: true } : { ok: false, message: mapAuthFormError(error) };
        if (data.session) {
          applySession(data.session);
          ensureRows(client);
        }
        return { ok: true, needsConfirmation: false };
      });
    },
    /** Signs out of this browser only (scope local), then forgets the last user id and the email cooldown. Never throws. */
    async signOut(): Promise<void> {
      try {
        await intentionally((client) => client.auth.signOut({ scope: "local" }));
      } catch {
        // scope "local" only clears this browser; a failure leaves a dead token that the server already rejects.
      }
      try {
        deps.forgetDevice?.();
      } catch {
        // Nothing of ours is readable if storage refuses access.
      }
      // Nobody asked for an account any more: a cloud feature signs in again as a new guest when it needs one.
      wanted = false;
      set({ status: "signed_out", userId: null, isAnonymous: true, email: null, identityReset: false });
    },
    /**
     * Sends the confirmation code again (sign-up not finished, or a guest's pending address). Same 60 s per-device cooldown as
     * the other emails. Auth answers the same for an unknown or already confirmed address, so this never says which.
     */
    async resendConfirmation(rawEmail: string): Promise<UpgradeResult> {
      const email = normalizeEmail(rawEmail);
      if (!isValidEmail(email)) return { ok: false, message: AUTH_MESSAGES.emailInvalid };
      const wait = emailCooldownMessage();
      if (wait !== null) return { ok: false, message: wait };
      deps.emailSentAt.set(deps.now());
      try {
        const client = deps.getClient();
        const guest = (await client.auth.getSession()).data.session?.user.is_anonymous === true;
        const { error } = await client.auth.resend({ type: guest ? "email_change" : "signup", email });
        return error ? { ok: false, message: mapAuthFormError(error) } : { ok: true };
      } catch (e) {
        return { ok: false, message: mapAuthFormError(e) };
      }
    },
    /** Asks for a password-reset email with a 6-digit code. The reply is the same for every well-formed address, so it cannot be used to find out who has an account. */
    async requestPasswordReset(rawEmail: string): Promise<UpgradeResult> {
      const email = normalizeEmail(rawEmail);
      if (email.length === 0) return { ok: false, message: AUTH_MESSAGES.emailEmpty };
      if (!isValidEmail(email)) return { ok: false, message: AUTH_MESSAGES.emailInvalid };
      const wait = emailCooldownMessage();
      if (wait !== null) return { ok: false, message: wait };
      deps.emailSentAt.set(deps.now());
      try {
        const { error } = await deps.getClient().auth.resetPasswordForEmail(email);
        return error ? { ok: false, message: mapAuthFormError(error) } : { ok: true };
      } catch (e) {
        return { ok: false, message: mapAuthFormError(e) };
      }
    },
    /** Sets a new password for the signed-in account (the reset code signs the person in). A guest cannot: there is no email to reset. */
    async updatePassword(password: string): Promise<UpgradeResult> {
      const bad = checkCredentials("a@b.co", password, "signup").password;
      if (bad !== null) return { ok: false, message: bad };
      try {
        return await intentionally(async (client) => {
          const session = (await client.auth.getSession()).data.session;
          if (!session || session.user.is_anonymous === true) return { ok: false, message: AUTH_MESSAGES.noResetSession };
          const { error } = await client.auth.updateUser({ password });
          return error ? { ok: false, message: mapAuthFormError(error) } : { ok: true };
        });
      } catch (e) {
        return { ok: false, message: mapAuthFormError(e) };
      }
    },
    async upgradeWithEmail(email: string): Promise<UpgradeResult> {
      const address = askForLink(email, () => {
        if (state.status !== "ready" || state.userId === null) return { ok: false, message: "Saving is paused, so email sign-in is not available yet." };
        if (!state.isAnonymous) return { ok: false, message: "This device already has an email." };
        return null;
      });
      if (typeof address !== "string") return address;
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
