import { AuthApiError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  AUTH_MESSAGES,
  cleanCode,
  createAuthController,
  EMAIL_COOLDOWN_MS,
  isValidCode,
  type AuthClientLike,
  type AuthDeps,
} from "@/features/auth/authController";
import { safeNextPath } from "@/features/auth/nextPath";
import { secondsLeft } from "@/features/auth/ui/ResendButton";
import { signInUrl } from "@/lib/auth/gate";

const ME = "00000000-0000-4000-8000-0000000000aa";
const PASSWORD = "correct horse battery";
type User = { id: string; is_anonymous?: boolean; email?: string };
type Session = { user: User };

function setup(options: { session?: Session | null } = {}) {
  let clock = 1_000_000;
  let sentAt: number | null = null;
  const signedIn: Session = { user: { id: ME, is_anonymous: false, email: "me@example.test" } };
  const auth = {
    getSession: vi.fn(() => Promise.resolve({ data: { session: options.session ?? null }, error: null })),
    signInAnonymously: vi.fn(),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    updateUser: vi.fn((): Promise<{ data: { user?: User }; error: unknown }> => Promise.resolve({ data: { user: signedIn.user }, error: null })),
    signUp: vi.fn((): Promise<{ data: { session: Session | null }; error: unknown }> => Promise.resolve({ data: { session: null }, error: null })),
    signInWithPassword: vi.fn(() => Promise.resolve({ data: { session: signedIn }, error: null as unknown })),
    signOut: vi.fn(() => Promise.resolve({ error: null as unknown })),
    verifyOtp: vi.fn((): Promise<{ data: { session: Session | null }; error: unknown }> => Promise.resolve({ data: { session: signedIn }, error: null })),
    resend: vi.fn(() => Promise.resolve({ data: {}, error: null as unknown })),
    resetPasswordForEmail: vi.fn(() => Promise.resolve({ data: {}, error: null as unknown })),
  };
  const deps: AuthDeps = {
    getClient: () => ({ auth }) as unknown as AuthClientLike,
    isOnline: () => true,
    onNetworkChange: () => () => undefined,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
    now: () => clock,
    emailSentAt: { get: () => sentAt, set: (t) => (sentAt = t) },
    lastUser: { get: () => null, set: () => undefined },
    allowAnonymous: () => false,
  };
  return { auth, controller: createAuthController(deps), tick: (ms: number) => (clock += ms) };
}

describe("the 6-digit code field", () => {
  it("keeps only digits, so a pasted '123 456' or '123-456' works", () => {
    expect(cleanCode("123 456")).toBe("123456");
    expect(cleanCode("123-456")).toBe("123456");
    expect(cleanCode(" abc ")).toBe("");
  });

  it("is valid with exactly 6 digits", () => {
    for (const ok of ["123456", "000000"]) expect(isValidCode(ok)).toBe(true);
    for (const bad of ["", "12345", "1234567"]) expect(isValidCode(bad)).toBe(false);
  });

  it("the resend wait counts down from 60 seconds and stops at zero", () => {
    expect(secondsLeft(0, 0)).toBe(60);
    expect(secondsLeft(0, 1)).toBe(60);
    expect(secondsLeft(0, 59_001)).toBe(1);
    expect(secondsLeft(0, EMAIL_COOLDOWN_MS)).toBe(0);
    expect(secondsLeft(0, EMAIL_COOLDOWN_MS * 3)).toBe(0);
  });
});

describe("sign-up with a code", () => {
  it("step 1 sends no return link and asks for the code; step 2 confirms and signs the person in", async () => {
    const s = setup();
    expect(await s.controller.signUpWithPassword("New@Example.test", PASSWORD)).toEqual({ ok: true, needsConfirmation: true });
    expect(s.auth.signUp).toHaveBeenCalledWith({ email: "new@example.test", password: PASSWORD });
    expect(await s.controller.verifyEmailCode(" New@Example.test ", "123 456", "signup")).toEqual({ ok: true });
    expect(s.auth.verifyOtp).toHaveBeenCalledWith({ email: "new@example.test", token: "123456", type: "signup" });
    expect(s.controller.getState()).toMatchObject({ status: "ready", userId: ME, isAnonymous: false, email: "me@example.test" });
  });

  it("a short code never reaches Auth", async () => {
    const s = setup();
    expect(await s.controller.verifyEmailCode("me@example.test", "123", "signup")).toEqual({ ok: false, message: AUTH_MESSAGES.codeInvalid });
    expect(await s.controller.verifyEmailCode("nope", "123456", "signup")).toEqual({ ok: false, message: AUTH_MESSAGES.emailInvalid });
    expect(s.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("a wrong or old code is one neutral sentence and leaves nobody signed in", async () => {
    const s = setup();
    s.auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: new AuthApiError("Token has expired or is invalid", 403, "otp_expired") });
    expect(await s.controller.verifyEmailCode("me@example.test", "123456", "signup")).toEqual({ ok: false, message: AUTH_MESSAGES.codeWrong });
    expect(s.controller.getState().userId).toBeNull();
  });

  it("an answer with no session is a failure, and a thrown fault is a sentence", async () => {
    const s = setup();
    s.auth.verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: null });
    expect(await s.controller.verifyEmailCode("me@example.test", "123456", "signup")).toEqual({ ok: false, message: AUTH_MESSAGES.codeWrong });
    s.auth.verifyOtp.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await s.controller.verifyEmailCode("me@example.test", "123456", "signup")).toEqual({ ok: false, message: "I could not reach the server, so try again later." });
  });

  it("a guest's pending address is confirmed as an email change", async () => {
    const s = setup({ session: { user: { id: ME, is_anonymous: true } } });
    await s.controller.verifyEmailCode("me@example.test", "123456", "signup");
    expect(s.auth.verifyOtp).toHaveBeenCalledWith({ email: "me@example.test", token: "123456", type: "email_change" });
  });

  it("resend waits 60 seconds after sign-up, then works again", async () => {
    const s = setup();
    await s.controller.signUpWithPassword("new@example.test", PASSWORD);
    expect(await s.controller.resendConfirmation("new@example.test")).toEqual({ ok: false, message: AUTH_MESSAGES.cooldown });
    s.tick(EMAIL_COOLDOWN_MS);
    expect(await s.controller.resendConfirmation("new@example.test")).toEqual({ ok: true });
    expect(s.auth.resend).toHaveBeenCalledWith({ type: "signup", email: "new@example.test" });
  });

  it("required mode never signs in anonymously during any of it", async () => {
    const s = setup();
    await s.controller.signUpWithPassword("new@example.test", PASSWORD);
    await s.controller.verifyEmailCode("new@example.test", "123456", "signup");
    expect(s.auth.signInAnonymously).not.toHaveBeenCalled();
  });
});

describe("log-in later needs no code", () => {
  it("email and password only: signInWithPassword, no verifyOtp, no email sent", async () => {
    const s = setup();
    expect(await s.controller.signInWithPassword("Me@Example.test", PASSWORD)).toEqual({ ok: true, needsConfirmation: false });
    expect(s.auth.signInWithPassword).toHaveBeenCalledWith({ email: "me@example.test", password: PASSWORD });
    expect(s.auth.verifyOtp).not.toHaveBeenCalled();
    expect(s.auth.resend).not.toHaveBeenCalled();
    expect(s.controller.getState().status).toBe("ready");
  });

  it("a wrong password is one neutral sentence", async () => {
    const s = setup();
    s.auth.signInWithPassword.mockResolvedValue({ data: { session: null as unknown as Session }, error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials") });
    expect(await s.controller.signInWithPassword("me@example.test", "wrong password")).toEqual({ ok: false, message: "That email or password is not right." });
  });
});

describe("forgot password with a code", () => {
  it("email -> code -> new password: recovery code first, then updateUser, signed in at the end", async () => {
    const s = setup();
    expect(await s.controller.requestPasswordReset("Me@Example.test")).toEqual({ ok: true });
    expect(s.auth.resetPasswordForEmail).toHaveBeenCalledWith("me@example.test");
    expect(await s.controller.verifyEmailCode("me@example.test", "654321", "recovery")).toEqual({ ok: true });
    expect(s.auth.verifyOtp).toHaveBeenCalledWith({ email: "me@example.test", token: "654321", type: "recovery" });
    s.auth.getSession.mockResolvedValue({ data: { session: { user: { id: ME, is_anonymous: false } } }, error: null });
    expect(await s.controller.updatePassword(PASSWORD)).toEqual({ ok: true });
    expect(s.auth.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
    expect(s.controller.getState()).toMatchObject({ status: "ready", isAnonymous: false });
  });

  it("every well-formed address gets the same answer", async () => {
    const a = setup();
    const b = setup();
    expect(await a.controller.requestPasswordReset("known@example.test")).toEqual(await b.controller.requestPasswordReset("unknown@example.test"));
  });

  it("a wrong recovery code leaves the password alone", async () => {
    const s = setup();
    s.auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: new AuthApiError("invalid", 403, "otp_expired") });
    expect((await s.controller.verifyEmailCode("me@example.test", "000000", "recovery")).ok).toBe(false);
    expect(s.auth.updateUser).not.toHaveBeenCalled();
  });
});

describe("where log-in sends people", () => {
  it("the gate redirects to /login with a safe return path", () => {
    expect(signInUrl("/settings?tab=1")).toBe("/login?next=%2Fsettings%3Ftab%3D1");
    expect(signInUrl("//evil.test")).toBe("/login");
    expect(signInUrl("/login")).toBe("/login");
  });

  it("a return path to an auth page or another site gives '/'", () => {
    for (const bad of ["/login", "/signup", "/forgot-password", "/sign-in", "//evil.test", "https://evil.test", "/\\evil.test"]) expect(safeNextPath(bad)).toBe("/");
    expect(safeNextPath("/kit?x=1")).toBe("/kit?x=1");
  });
});
