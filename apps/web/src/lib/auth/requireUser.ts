import { createHmac } from "node:crypto";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";
import { ConfigError } from "@/lib/env";
import { getServerClient } from "@/lib/supabase/server";
import { hashSecret } from "./secret";

export interface AuthedUser {
  /** auth.uid(). Never log it, never send it to a client or into telemetry; use `userHash`. */
  userId: string;
  /** HMAC-SHA256 of the user id with a server secret, 16 hex characters. Safe for counters and logs. */
  userHash: string;
  isAnonymous: boolean;
}

/** Stable per user and per secret; not reversible without the secret. */
function hashUserId(userId: string): string {
  let secret: string;
  try {
    secret = hashSecret();
  } catch (e) {
    if (e instanceof ConfigError) throw new AppError("config", { cause: e });
    throw e;
  }
  return createHmac("sha256", secret).update(`u:${userId}`).digest("hex").slice(0, 16);
}

/**
 * The only way a route learns who is calling. The id comes from `auth.getUser()`, which asks the Supabase Auth server
 * to verify the token (never `getSession()`, which trusts the cookie). Nothing the client puts in a header or body is
 * read here. 401 for a missing, forged or expired token; 503 when Supabase Auth cannot be reached, so an outage is
 * not shown to the caller as "you are signed out".
 */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const client = await getServerClient(req);
  let result: Awaited<ReturnType<typeof client.auth.getUser>>;
  try {
    result = await client.auth.getUser();
  } catch (e) {
    throw new AppError("store_unavailable", { cause: e });
  }
  const { data, error } = result;
  if (error) {
    const unreachable = isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500;
    throw new AppError(unreachable ? "store_unavailable" : "unauthorized", { cause: error });
  }
  if (!data.user) throw new AppError("unauthorized");
  return { userId: data.user.id, userHash: hashUserId(data.user.id), isAnonymous: data.user.is_anonymous === true };
}
