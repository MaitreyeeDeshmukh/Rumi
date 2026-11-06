"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { authOptional } from "@/lib/supabase/config";
import { reportClientError } from "@/lib/telemetry/reportClientError";
import { LAST_USER_KEY, EMAIL_SENT_KEY } from "./afterAccountDeleted";
import { createAuthController, INITIAL_AUTH_STATE, type AuthDeps, type AuthState, type UpgradeResult } from "./authController";

export interface AuthValue extends AuthState {
  /** Manual retry after `degraded` or `offline`. */
  retry(): void;
  /**
   * Signs in anonymously if nobody is signed in yet, then answers with the state (check `status === "ready"`). Call it right
   * before a cloud feature needs a user (turning memory on, a sync). Safe to call again and again; never throws.
   */
  ensureSignedIn(): Promise<AuthState>;
  /** Sign up or sign in with an emailed link. The reply is the same whether or not the address already has an account. */
  signInWithEmail(email: string): Promise<UpgradeResult>;
  /** Adds an email to this anonymous identity. The reply is the same whether or not the address is already in use. */
  upgradeWithEmail(email: string): Promise<UpgradeResult>;
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
  onEnsureRowsFailed: () => reportClientError("ensure_rows_failed"),
});

/** Used when no provider is mounted: the app still renders and runs on this device. */
const NO_PROVIDER: AuthValue = {
  ...INITIAL_AUTH_STATE,
  status: "degraded",
  retry: () => undefined,
  ensureSignedIn: () => Promise.resolve({ ...INITIAL_AUTH_STATE, status: "degraded" }),
  signInWithEmail: () => Promise.resolve({ ok: false, message: "Sign-in is not available right now." }),
  upgradeWithEmail: () => Promise.resolve({ ok: false, message: "Saving is paused, so email sign-in is not available yet." }),
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
  const signInWithEmail = useCallback((email: string) => controller.signInWithEmail(email), [controller]);
  const value = useMemo<AuthValue>(() => ({ ...state, retry, ensureSignedIn, signInWithEmail, upgradeWithEmail }), [state, retry, ensureSignedIn, signInWithEmail, upgradeWithEmail]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthValue => useContext(AuthContext);
