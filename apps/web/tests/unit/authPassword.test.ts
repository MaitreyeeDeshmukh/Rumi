import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { AUTH_MESSAGES, checkCredentials, createAuthController, EMAIL_COOLDOWN_MS, type AuthClientLike, type AuthDeps } from "@/features/auth/authController";
import { countWords, literalLint } from "@/lib/literalLint";

const ME = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";
const PASSWORD = "correct horse battery";

type User = { id: string; is_anonymous?: boolean; email?: string };
type Listener = (event: string, session: { user: User } | null) => void;

function setup(options: { session?: { user: User } | null; last?: string | null } = {}) {
  let clock = 1_000_000;
  let emailAt: number | null = null;
  let last = options.last ?? null;
  const listeners: Listener[] = [];
  const emit = (event: string, session: { user: User } | null) => listeners.slice().forEach((l) => l(event, session));
  const session = (user: User) => ({ user });
  const auth = {
    getSession: vi.fn(() => Promise.resolve({ data: { session: options.session ?? null }, error: null })),
    signInAnonymously: vi.fn(() => Promise.resolve({ data: { session: session({ id: ME, is_anonymous: true }) }, error: null })),
    onAuthStateChange: vi.fn((cb: Listener) => {
      listeners.push(cb);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    updateUser: vi.fn((): Promise<{ data: { user?: User }; error: unknown }> => Promise.resolve({ data: { user: { id: ME, is_anonymous: false, email: "new@example.test" } }, error: null })),
    signUp: vi.fn((): Promise<{ data: { session: { user: User } | null; user?: User | null }; error: unknown }> => Promise.resolve({ data: { session: null, user: { id: OTHER } }, error: null })),
    signInWithPassword: vi.fn((): Promise<{ data: { session: { user: User } | null }; error: unknown }> => {
      emit("SIGNED_IN", session({ id: OTHER, email: "me@example.test" }));
      return Promise.resolve({ data: { session: session({ id: OTHER, email: "me@example.test" }) }, error: null });
    }),
    signOut: vi.fn(() => {
      emit("SIGNED_OUT", null);
      return Promise.resolve({ error: null as unknown });
    }),
    verifyOtp: vi.fn(() => Promise.resolve({ data: { session: null as { user: User } | null }, error: null as unknown })),
    resend: vi.fn(() => Promise.resolve({ data: {}, error: null as unknown })),
    resetPasswordForEmail: vi.fn(() => Promise.resolve({ data: {}, error: null as unknown })),
  };
  const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }));
  const forgetDevice = vi.fn(() => {
    last = null;
    emailAt = null;
  });
  const deps: AuthDeps = {
    getClient: () => ({ auth, rpc }) as unknown as AuthClientLike,
    isOnline: () => true,
    onNetworkChange: () => () => undefined,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
    now: () => clock,
    emailSentAt: { get: () => emailAt, set: (t) => (emailAt = t) },
    lastUser: { get: () => last, set: (id) => (last = id) },
    redirectTo: () => "https://rumi.test",
    forgetDevice,
  };
  const controller = createAuthController(deps);
  return { controller, auth, forgetDevice, emit, last: () => last, tick: (ms: number) => (clock += ms), emailAt: () => emailAt };
}

describe("checkCredentials", () => {
  it("log-in needs an address and a password, with no length rule (older accounts may have shorter ones)", () => {
    expect(checkCredentials("", "", "login")).toEqual({ email: "Enter your email.", password: "Enter your password." });
    expect(checkCredentials("not-an-email", "x", "login")).toEqual({ email: "That email address does not look right.", password: null });
    expect(checkCredentials("  Me@Example.TEST ", "short", "login")).toEqual({ email: null, password: null });
  });

  it("sign-up needs 8 to 72 characters", () => {
    expect(checkCredentials("me@example.test", "1234567", "signup").password).toBe("Use at least 8 characters.");
    expect(checkCredentials("me@example.test", "12345678", "signup").password).toBeNull();
    expect(checkCredentials("me@example.test", "x".repeat(72), "signup").password).toBeNull();
    expect(checkCredentials("me@example.test", "x".repeat(73), "signup").password).toBe("Use 72 characters or fewer.");
  });

  it("every sentence is one literal sentence of 15 words or fewer", () => {
    const all = [...Object.values(AUTH_MESSAGES), "Use at least 8 characters.", "Use 72 characters or fewer."];
    for (const m of all) {
      expect({ m, words: countWords(m) <= 15 }).toEqual({ m, words: true });
      expect({ m, lint: literalLint(m).ok }).toEqual({ m, lint: true });
      expect(m.match(/[.!?]/g)).toHaveLength(1);
    }
  });
});

describe("signInWithPassword", () => {
  it("trims and lowercases the address, passes the password only to Auth, and becomes ready with the email", async () => {
    const s = setup();
    const result = await s.controller.signInWithPassword("  Me@Example.TEST ", PASSWORD);
    expect(result).toEqual({ ok: true, needsConfirmation: false });
    expect(s.auth.signInWithPassword).toHaveBeenCalledWith({ email: "me@example.test", password: PASSWORD });
    expect(s.controller.getState()).toMatchObject({ status: "ready", userId: OTHER, isAnonymous: false, email: "me@example.test" });
    expect(s.last()).toBe(OTHER);
  });

  it("does not mark a deliberate log-in as 'this browser signed in as someone else'", async () => {
    const s = setup({ last: ME });
    await s.controller.signInWithPassword("me@example.test", PASSWORD);
    expect(s.controller.getState().identityReset).toBe(false);
  });

  it("an empty or short-form input never reaches Auth", async () => {
    const s = setup();
    expect(await s.controller.signInWithPassword("", PASSWORD)).toEqual({ ok: false, message: "Enter your email." });
    expect(await s.controller.signInWithPassword("me@example.test", "")).toEqual({ ok: false, message: "Enter your password." });
    expect(s.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("wrong credentials: one literal sentence, one call, no retry, state unchanged", async () => {
    const s = setup();
    s.auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials") });
    const result = await s.controller.signInWithPassword("me@example.test", "wrong password");
    expect(result).toEqual({ ok: false, message: "That email or password is not right." });
    expect(s.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(s.controller.getState().userId).toBeNull();
  });

  it("an unconfirmed email is flagged so the form can offer a resend", async () => {
    const s = setup();
    s.auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: new AuthApiError("Email not confirmed", 400, "email_not_confirmed") });
    expect(await s.controller.signInWithPassword("me@example.test", PASSWORD)).toEqual({ ok: false, message: "Your email is not confirmed yet, so check your inbox.", unconfirmed: true });
  });

  it.each([
    ["rate limit", new AuthApiError("x", 429, "over_request_rate_limit"), "There were too many tries, so wait a while and try again."],
    ["network", new AuthRetryableFetchError("fetch failed", 0), "I could not reach the server, so try again later."],
    ["captcha", new AuthApiError("x", 400, "captcha_failed"), "The safety check failed, so try again."],
  ])("%s: mapped, one call", async (_label, error, message) => {
    const s = setup();
    s.auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error });
    expect(await s.controller.signInWithPassword("me@example.test", PASSWORD)).toEqual({ ok: false, message });
    expect(s.auth.signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it("a thrown fault is a sentence, never an exception, and never contains the password", async () => {
    const s = setup();
    s.auth.signInWithPassword.mockRejectedValue(new TypeError(`Failed to fetch ${PASSWORD}`));
    const result = await s.controller.signInWithPassword("me@example.test", PASSWORD);
    expect(result).toEqual({ ok: false, message: "I could not reach the server, so try again later." });
    expect(JSON.stringify(result)).not.toContain("horse");
  });

  it("a restore that is still running finishes first, so it cannot overwrite the log-in", async () => {
    const s = setup();
    const stop = s.controller.start();
    await s.controller.signInWithPassword("me@example.test", PASSWORD);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(s.controller.getState()).toMatchObject({ status: "ready", userId: OTHER });
    stop();
  });
});

describe("signUpWithPassword", () => {
  it("a new visitor: auth.signUp with the normalised address, and a confirmation email means needsConfirmation", async () => {
    const s = setup();
    const result = await s.controller.signUpWithPassword(" New@Example.test ", PASSWORD);
    expect(result).toEqual({ ok: true, needsConfirmation: true });
    expect(s.auth.signUp).toHaveBeenCalledWith({ email: "new@example.test", password: PASSWORD });
    expect(s.auth.updateUser).not.toHaveBeenCalled();
    expect(s.controller.getState().userId).toBeNull();
  });

  it("starts the 60 second email cooldown, so Resend cannot fire at once", async () => {
    const s = setup();
    await s.controller.signUpWithPassword("new@example.test", PASSWORD);
    expect(s.emailAt()).not.toBeNull();
    expect(await s.controller.resendConfirmation("new@example.test")).toEqual({ ok: false, message: AUTH_MESSAGES.cooldown });
    expect(s.auth.resend).not.toHaveBeenCalled();
  });

  it("when Auth returns a session (confirmation off), the person is signed in", async () => {
    const s = setup();
    s.auth.signUp.mockResolvedValue({ data: { session: { user: { id: OTHER, email: "new@example.test" } } }, error: null });
    expect(await s.controller.signUpWithPassword("new@example.test", PASSWORD)).toEqual({ ok: true, needsConfirmation: false });
    expect(s.controller.getState()).toMatchObject({ status: "ready", userId: OTHER, isAnonymous: false, email: "new@example.test" });
  });

  it("an address that already exists gives exactly the answer of a new one when Auth hides it", async () => {
    const fresh = setup();
    const existing = setup();
    existing.auth.signUp.mockResolvedValue({ data: { session: null, user: { id: OTHER, identities: [] } as unknown as User }, error: null });
    expect(await existing.controller.signUpWithPassword("me@example.test", PASSWORD)).toEqual(await fresh.controller.signUpWithPassword("new@example.test", PASSWORD));
  });

  it("user_already_exists as an error: a neutral sentence that does not confirm the account", async () => {
    const s = setup();
    s.auth.signUp.mockResolvedValue({ data: { session: null }, error: new AuthApiError("User already registered", 422, "user_already_exists") });
    expect(await s.controller.signUpWithPassword("me@example.test", PASSWORD)).toEqual({ ok: false, message: "Check your email, or try signing in." });
  });

  it("weak password from Auth is mapped", async () => {
    const s = setup();
    s.auth.signUp.mockResolvedValue({ data: { session: null }, error: new AuthApiError("weak", 422, "weak_password") });
    expect(await s.controller.signUpWithPassword("me@example.test", PASSWORD)).toEqual({ ok: false, message: "Choose a stronger password with at least 8 characters." });
  });

  it("a short password never reaches Auth", async () => {
    const s = setup();
    expect(await s.controller.signUpWithPassword("me@example.test", "short")).toEqual({ ok: false, message: "Use at least 8 characters." });
    expect(s.auth.signUp).not.toHaveBeenCalled();
    expect(s.auth.updateUser).not.toHaveBeenCalled();
  });

  it("a guest keeps its data: updateUser on the same user, never signUp", async () => {
    const s = setup({ session: { user: { id: ME, is_anonymous: true } } });
    const result = await s.controller.signUpWithPassword("New@Example.test", PASSWORD);
    expect(result).toEqual({ ok: true, needsConfirmation: false });
    expect(s.auth.updateUser).toHaveBeenCalledWith({ email: "new@example.test", password: PASSWORD });
    expect(s.auth.signUp).not.toHaveBeenCalled();
    expect(s.controller.getState()).toMatchObject({ status: "ready", userId: ME, isAnonymous: false, email: "new@example.test" });
  });

  it("a guest with email confirmation on stays a guest until the code is typed", async () => {
    const s = setup({ session: { user: { id: ME, is_anonymous: true } } });
    s.auth.updateUser.mockResolvedValue({ data: { user: { id: ME, is_anonymous: true } }, error: null });
    expect(await s.controller.signUpWithPassword("new@example.test", PASSWORD)).toEqual({ ok: true, needsConfirmation: true });
    expect(s.controller.getState().isAnonymous).toBe(true);
  });

  it("a guest using an address that has an account gets the neutral sentence", async () => {
    const s = setup({ session: { user: { id: ME, is_anonymous: true } } });
    s.auth.updateUser.mockResolvedValue({ data: {}, error: new AuthApiError("registered", 422, "email_exists") });
    expect(await s.controller.signUpWithPassword("me@example.test", PASSWORD)).toEqual({ ok: false, message: "Check your email, or try signing in." });
  });

  it("a non-guest session is not upgraded: it gets a new account through signUp", async () => {
    const s = setup({ session: { user: { id: ME, is_anonymous: false, email: "old@example.test" } } });
    await s.controller.signUpWithPassword("new@example.test", PASSWORD);
    expect(s.auth.signUp).toHaveBeenCalledTimes(1);
    expect(s.auth.updateUser).not.toHaveBeenCalled();
  });
});

describe("resendConfirmation", () => {
  it("calls auth.resend for a signup (the email carries a code, so no return address)", async () => {
    const s = setup();
    expect(await s.controller.resendConfirmation(" New@Example.test ")).toEqual({ ok: true });
    expect(s.auth.resend).toHaveBeenCalledWith({ type: "signup", email: "new@example.test" });
  });

  it("a guest's pending address is resent as an email change", async () => {
    const s = setup({ session: { user: { id: ME, is_anonymous: true } } });
    await s.controller.resendConfirmation("new@example.test");
    expect(s.auth.resend).toHaveBeenCalledWith(expect.objectContaining({ type: "email_change" }));
  });

  it("allows one per minute per device, then again after the minute", async () => {
    const s = setup();
    expect((await s.controller.resendConfirmation("new@example.test")).ok).toBe(true);
    expect(await s.controller.resendConfirmation("new@example.test")).toEqual({ ok: false, message: AUTH_MESSAGES.cooldown });
    s.tick(EMAIL_COOLDOWN_MS);
    expect((await s.controller.resendConfirmation("new@example.test")).ok).toBe(true);
    expect(s.auth.resend).toHaveBeenCalledTimes(2);
  });

  it("a bad address never reaches Auth, and a rate limit is a sentence", async () => {
    const s = setup();
    expect(await s.controller.resendConfirmation("nope")).toEqual({ ok: false, message: "That email address does not look right." });
    expect(s.auth.resend).not.toHaveBeenCalled();
    s.auth.resend.mockResolvedValue({ data: {}, error: new AuthApiError("x", 429, "over_email_send_rate_limit") });
    expect(await s.controller.resendConfirmation("new@example.test")).toEqual({ ok: false, message: "Too many emails were sent, so try again in an hour." });
  });
});

describe("requestPasswordReset", () => {
  it("asks Auth for a code email, and answers the same for any well-formed address", async () => {
    const a = setup();
    const b = setup();
    b.auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    expect(await a.controller.requestPasswordReset(" Me@Example.test ")).toEqual({ ok: true });
    expect(await b.controller.requestPasswordReset("nobody@example.test")).toEqual({ ok: true });
    expect(a.auth.resetPasswordForEmail).toHaveBeenCalledWith("me@example.test");
  });

  it("is held to the 60 second per-device cooldown", async () => {
    const s = setup();
    await s.controller.requestPasswordReset("me@example.test");
    expect(await s.controller.requestPasswordReset("me@example.test")).toEqual({ ok: false, message: AUTH_MESSAGES.cooldown });
    expect(s.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });

  it("an empty or malformed address never reaches Auth", async () => {
    const s = setup();
    expect(await s.controller.requestPasswordReset("")).toEqual({ ok: false, message: "Enter your email." });
    expect(await s.controller.requestPasswordReset("nope")).toEqual({ ok: false, message: "That email address does not look right." });
    expect(s.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("updatePassword", () => {
  it("sets the new password for a signed-in account", async () => {
    const s = setup({ session: { user: { id: ME, is_anonymous: false, email: "me@example.test" } } });
    expect(await s.controller.updatePassword(PASSWORD)).toEqual({ ok: true });
    expect(s.auth.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
  });

  it("refuses a short password before calling Auth", async () => {
    const s = setup({ session: { user: { id: ME, is_anonymous: false } } });
    expect(await s.controller.updatePassword("short")).toEqual({ ok: false, message: "Use at least 8 characters." });
    expect(s.auth.updateUser).not.toHaveBeenCalled();
  });

  it("without a session, or as a guest, there is no reset to finish", async () => {
    for (const session of [null, { user: { id: ME, is_anonymous: true } }]) {
      const s = setup({ session });
      expect(await s.controller.updatePassword(PASSWORD)).toEqual({ ok: false, message: AUTH_MESSAGES.noResetSession });
      expect(s.auth.updateUser).not.toHaveBeenCalled();
    }
  });

  it("maps the same-password refusal", async () => {
    const s = setup({ session: { user: { id: ME, is_anonymous: false } } });
    s.auth.updateUser.mockResolvedValue({ data: {}, error: new AuthApiError("x", 422, "same_password") });
    expect(await s.controller.updatePassword(PASSWORD)).toEqual({ ok: false, message: "Choose a password you have not used before." });
  });
});

describe("signOut", () => {
  it("signs out of this browser only, forgets the device, and ends signed_out (not degraded)", async () => {
    const s = setup({ last: ME });
    s.controller.start();
    await s.controller.signInWithPassword("me@example.test", PASSWORD);
    await s.controller.signOut();
    expect(s.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(s.forgetDevice).toHaveBeenCalledTimes(1);
    expect(s.last()).toBeNull();
    expect(s.controller.getState()).toMatchObject({ status: "signed_out", userId: null, email: null, isAnonymous: true, identityReset: false });
  });

  it("never throws, even when Auth and storage both fail", async () => {
    const s = setup();
    s.auth.signOut.mockRejectedValue(new Error("boom"));
    s.forgetDevice.mockImplementation(() => {
      throw new Error("storage");
    });
    await expect(s.controller.signOut()).resolves.toBeUndefined();
    expect(s.controller.getState().status).toBe("signed_out");
  });

  it("a guest session started later is a new guest: no 'signed in as someone else' notice", async () => {
    const s = setup({ last: ME });
    await s.controller.signOut();
    await s.controller.ensureSignedIn();
    expect(s.controller.getState()).toMatchObject({ status: "ready", isAnonymous: true, identityReset: false });
  });
});

describe("state", () => {
  it("a restored session carries the email, and a guest has none", async () => {
    const named = setup({ session: { user: { id: OTHER, is_anonymous: false, email: "me@example.test" } } });
    named.controller.start();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(named.controller.getState()).toMatchObject({ isAnonymous: false, email: "me@example.test" });
    const guest = setup({ session: { user: { id: ME, is_anonymous: true } } });
    guest.controller.start();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(guest.controller.getState()).toMatchObject({ isAnonymous: true, email: null });
  });
});
