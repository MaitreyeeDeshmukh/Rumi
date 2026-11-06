"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { authOptional } from "@/lib/supabase/config";
import { reportClientError } from "@/lib/telemetry/reportClientError";
import { LAST_USER_KEY, EMAIL_SENT_KEY } from "./afterAccountDeleted";
import { createAuthController, INITIAL_AUTH_STATE, type AuthDeps, type AuthResult, type AuthState, type UpgradeResult } from "./authController";

export interface AuthValue extends AuthState {
  /** Manual retry after `degraded` or `offline`. */
  retry(): void;
  /**
   * Signs in anonymously if nobody is signed in yet, then answers with the state (check `status === "ready"`). Call it right
   * before a cloud feature needs a user (turning memory on, a sync). Safe to call again and again; never throws.
   */
  ensureSignedIn(): Promise<AuthState>;
  /** Adds an email to this anonymous identity. The reply is the same whether or not the address is already in use. */
  upgradeWithEmail(email: string): Promise<UpgradeResult>;
  /** Makes an account with an email and a password. A guest keeps its saved data. With `needsConfirmation` the person must type the emailed 6-digit code (`verifyEmailCode`) first; the reply never says whether the address was already in use. */
  signUpWithPassword(email: string, password: string): Promise<AuthResult>;
  /** Logs in with an email and a password. A reply with `unconfirmed` means the email is not confirmed yet. */
  signInWithPassword(email: string, password: string): Promise<AuthResult>;
  /** Developer bypass: signs in the NEXT_PUBLIC_DEV_BYPASS_EMAIL account with no password. Fails everywhere but a non-production build with that variable set. */
  signInAsDeveloper(email: string): Promise<AuthResult>;
  /** Signs out of this browser only and forgets the remembered user id. Never throws. */
  signOut(): Promise<void>;
  /** Checks the 6-digit code from the email and signs the person in. "signup" confirms a new account; "recovery" is the password-reset code. */
  verifyEmailCode(email: string, code: string, purpose: "signup" | "recovery"): Promise<UpgradeResult>;
  /** Sends the confirmation code again. One per minute per device. */
  resendConfirmation(email: string): Promise<UpgradeResult>;
  /** Sends a password-reset email with a 6-digit code. The reply is the same for every well-formed address. */
  requestPasswordReset(email: string): Promise<UpgradeResult>;
  /** Sets a new password for the signed-in account (the reset code signs the person in). */
  updatePassword(password: string): Promise<UpgradeResult>;
}

const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Some browsers throw on access when storage is blocked; the identity-change notice is simply not available then.
    return null;
  }
};

/** Kept in memory too, so the email cooldown still holds for this page when storage is blocked. */
let emailAskedAt: number | null = null;

const browserDeps = (): AuthDeps => ({
  getClient: getBrowserClient,
  isOnline: () => navigator.onLine,
  onNetworkChange(handler) {
    const on = () => handler(true);
    const off = () => handler(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
  now: Date.now,
  emailSentAt: {
    get() {
      let stored: number | null = null;
      try {
        const n = Number(storage()?.getItem(EMAIL_SENT_KEY));
        stored = Number.isFinite(n) && n > 0 ? n : null;
      } catch {
        // Blocked storage: only the in-memory time below is known.
      }
      return stored === null ? emailAskedAt : Math.max(stored, emailAskedAt ?? 0);
    },
    set(t) {
      emailAskedAt = t;
      try {
        storage()?.setItem(EMAIL_SENT_KEY, String(t));
      } catch {
        // Blocked or full storage: the cooldown then only lasts for this page.
      }
    },
  },
  lastUser: {
    get() {
      try {
        return storage()?.getItem(LAST_USER_KEY) ?? null;
      } catch {
        // Blocked storage: no previous identity is known.
        return null;
      }
    },
    set(id) {
      try {
        storage()?.setItem(LAST_USER_KEY, id);
      } catch {
        // Blocked or full storage: the notice is lost, nothing else is.
      }
    },
  },
  redirectTo: () => window.location.origin,
  allowAnonymous: authOptional,
  forgetDevice() {
    emailAskedAt = null;
    for (const key of [LAST_USER_KEY, EMAIL_SENT_KEY]) {
      try {
        storage()?.removeItem(key);
      } catch {
        // Blocked storage: nothing of ours is readable either.
      }
    }
  },
  onEnsureRowsFailed: () => reportClientError("ensure_rows_failed"),
});

const UNAVAILABLE = { ok: false, message: "Accounts are not available right now, so try again later." } as const;

/** Used when no provider is mounted: the app still renders and runs on this device. */
const NO_PROVIDER: AuthValue = {
  ...INITIAL_AUTH_STATE,
  status: "degraded",
  retry: () => undefined,
  ensureSignedIn: () => Promise.resolve({ ...INITIAL_AUTH_STATE, status: "degraded" }),
  upgradeWithEmail: () => Promise.resolve({ ok: false, message: "Saving is paused, so email sign-in is not available yet." }),
  signUpWithPassword: () => Promise.resolve(UNAVAILABLE),
  signInWithPassword: () => Promise.resolve(UNAVAILABLE),
  signInAsDeveloper: () => Promise.resolve(UNAVAILABLE),
  signOut: () => Promise.resolve(),
  verifyEmailCode: () => Promise.resolve(UNAVAILABLE),
  resendConfirmation: () => Promise.resolve(UNAVAILABLE),
  requestPasswordReset: () => Promise.resolve(UNAVAILABLE),
  updatePassword: () => Promise.resolve(UNAVAILABLE),
};

const AuthContext = createContext<AuthValue>(NO_PROVIDER);

/**
 * Restores a session this browser already has and keeps it fresh. It does NOT sign anyone in on load: a cloud feature
 * calls `ensureSignedIn()` when it needs a user. Renders its children at once; it never waits for auth.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => createAuthController(browserDeps()));
  useEffect(() => controller.start(), [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, () => INITIAL_AUTH_STATE);
  const retry = useCallback(() => controller.retry(), [controller]);
  const ensureSignedIn = useCallback(() => controller.ensureSignedIn(), [controller]);
  const upgradeWithEmail = useCallback((email: string) => controller.upgradeWithEmail(email), [controller]);
  const actions = useMemo(
    () => ({
      signUpWithPassword: (email: string, password: string) => controller.signUpWithPassword(email, password),
      signInWithPassword: (email: string, password: string) => controller.signInWithPassword(email, password),
      signInAsDeveloper: (email: string) => controller.signInAsDeveloper(email),
      signOut: () => controller.signOut(),
      verifyEmailCode: (email: string, code: string, purpose: "signup" | "recovery") => controller.verifyEmailCode(email, code, purpose),
      resendConfirmation: (email: string) => controller.resendConfirmation(email),
      requestPasswordReset: (email: string) => controller.requestPasswordReset(email),
      updatePassword: (password: string) => controller.updatePassword(password),
    }),
    [controller],
  );
  const value = useMemo<AuthValue>(() => ({ ...state, retry, ensureSignedIn, upgradeWithEmail, ...actions }), [state, retry, ensureSignedIn, upgradeWithEmail, actions]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthValue => useContext(AuthContext);
