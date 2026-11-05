// stub for lane merge: owned by prod-auth (frozen signature, addendum section 3). Delete this file at merge.
export type AuthStatus = 'signing_in' | 'ready' | 'degraded' | 'offline';
export interface AuthValue {
  status: AuthStatus;
  userId: string | null;
  isAnonymous: boolean;
  retry(): void;
  upgradeWithEmail(email: string): Promise<{ ok: true } | { ok: false; message: string }>;
}

export function useAuth(): AuthValue {
  return { status: 'signing_in', userId: null, isAnonymous: true, retry: () => undefined, upgradeWithEmail: async () => ({ ok: false, message: 'stub' }) };
}
