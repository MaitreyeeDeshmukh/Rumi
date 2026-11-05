import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/browser";

/** The id this browser last signed in as (identity-change notice) and when it last asked for an email link. */
export const LAST_USER_KEY = "rumi.auth.lastUser";
export const EMAIL_SENT_KEY = "rumi.auth.emailSentAt";

export interface AfterDeleteDeps {
  storage: Pick<Storage, "removeItem"> | null;
  auth: Pick<SupabaseClient["auth"], "signOut">;
}

const browserDeps = (): AfterDeleteDeps => {
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    // Storage blocked: there is nothing of ours in it to clear.
  }
  return { storage, auth: getBrowserClient().auth };
};

/**
 * The UI calls this after /api/account/delete answered `{ ok: true }`. The server has already expired the session
 * cookies and removed the user; this clears what only the browser holds (the remembered user id and the email
 * cooldown) and drops the local copy of the session. It never throws: each step is tried on its own, because the
 * account is already gone and the person must not see an error for cleanup.
 */
export async function afterAccountDeleted(deps?: AfterDeleteDeps): Promise<void> {
  let d: AfterDeleteDeps | undefined = deps;
  try {
    d ??= browserDeps();
  } catch {
    // Supabase is not configured in this browser, so there is no session to drop either.
    return;
  }
  for (const key of [LAST_USER_KEY, EMAIL_SENT_KEY]) {
    try {
      d.storage?.removeItem(key);
    } catch {
      // A browser that refuses storage access refuses reads too, so nothing readable is left behind.
    }
  }
  try {
    await d.auth.signOut({ scope: "local" });
  } catch {
    // scope "local" only clears this browser; a failure leaves a dead token that the server already rejects.
  }
}
