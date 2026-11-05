"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { createAuthController, INITIAL_AUTH_STATE, type AuthDeps, type AuthState, type UpgradeResult } from "./authController";

export interface AuthValue extends AuthState {
  /** Manual retry after `degraded` or `offline`. */
  retry(): void;
  /** Adds an email to this anonymous identity. The reply is the same whether or not the address is already in use. */
  upgradeWithEmail(email: string): Promise<UpgradeResult>;
}

const LAST_USER_KEY = "rumi.auth.lastUser";

const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Some browsers throw on access when storage is blocked; the identity-change notice is simply not available then.
    return null;
  }
};

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
});

/** Used when no provider is mounted: the app still renders and runs on this device. */
const NO_PROVIDER: AuthValue = {
  ...INITIAL_AUTH_STATE,
  status: "degraded",
  retry: () => undefined,
  upgradeWithEmail: () => Promise.resolve({ ok: false, message: "Saving is paused, so email sign-in is not available yet." }),
};

const AuthContext = createContext<AuthValue>(NO_PROVIDER);

/** Signs in anonymously once and keeps the session. Renders its children at once; it never waits for auth. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => createAuthController(browserDeps()));
  useEffect(() => controller.start(), [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, () => INITIAL_AUTH_STATE);
  const retry = useCallback(() => controller.retry(), [controller]);
  const upgradeWithEmail = useCallback((email: string) => controller.upgradeWithEmail(email), [controller]);
  const value = useMemo<AuthValue>(() => ({ ...state, retry, upgradeWithEmail }), [state, retry, upgradeWithEmail]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthValue => useContext(AuthContext);
