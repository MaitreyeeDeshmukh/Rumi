import { randomBytes } from "node:crypto";
import { ConfigError, getSessionSecret, isProduction } from "@/lib/env";
import { createLogger } from "@/lib/log";

/** Used only outside production, so local work and tests need no secret. Never used when NODE_ENV is production. */
const DEV_SECRET = "rumi-dev-only-secret-never-used-in-production";

/**
 * Key for hashing user ids and client addresses (SESSION_SECRET). Outside production a fixed development secret is
 * used when none is set. In production a missing or too short secret throws ConfigError, even with MOCK_AI=1.
 */
export function hashSecret(): string {
  const secret = getSessionSecret();
  if (secret) return secret;
  if (!isProduction()) return DEV_SECRET;
  throw new ConfigError(["SESSION_SECRET"]);
}

let processKey: string | undefined;

/**
 * Key for hashing client addresses only. Same as the hash secret when there is one; otherwise a random key made once
 * per process, so the in-memory limiter keeps working with no configuration and no address hash is guessable.
 */
export function hashingKey(): string {
  try {
    return hashSecret();
  } catch (e) {
    // No usable secret: the address hash only has to be stable inside this process. This is a misconfiguration in
    // production, so it is logged once at ERROR (the variable name only, never a value).
    if (processKey === undefined) createLogger({ requestId: "process", route: "hashingKey" }).error("session_secret_unusable", e, { code: "config" });
    processKey ??= randomBytes(32).toString("hex");
    return processKey;
  }
}
