import { AppError } from "@/lib/errors";
import { mockAiEnabled, mockOutsideLocalDev } from "@/lib/env";
import { authOptional } from "@/lib/supabase/config";
import type { GuardOptions } from "@/lib/security/guardRequest";
import { requireUser, type AuthedUser } from "./requireUser";

/** A caller with an email. A guest (anonymous) session is the same as signed out here. */
async function requireEmailUser(req: Request): Promise<AuthedUser> {
  const user = await requireUser(req);
  if (user.isAnonymous) throw new AppError("unauthorized");
  return user;
}

/**
 * Who may call the AI and voice routes. Default: only a signed-in person with an email (401 otherwise, 503 when Auth is
 * down). No lookup at all in the two demo cases that never touch Supabase: NEXT_PUBLIC_AUTH_OPTIONAL=1, and MOCK_AI on a
 * plain local run.
 */
export function routeAuth(): Pick<GuardOptions, "authenticate" | "requireAuth"> {
  if (authOptional() || (mockAiEnabled() && !mockOutsideLocalDev())) return { authenticate: null };
  return { authenticate: requireEmailUser, requireAuth: true };
}
