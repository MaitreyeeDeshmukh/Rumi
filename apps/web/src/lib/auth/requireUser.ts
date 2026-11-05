// stub for lane merge: owned by prod-auth. Delete this file at merge.
import { AppError } from "@/lib/errors";

export async function requireUser(): Promise<{ userId: string; userHash: string; isAnonymous: boolean }> {
  throw new AppError("unauthorized");
}
