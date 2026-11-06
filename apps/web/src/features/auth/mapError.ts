import type { AppErrorCode } from "@/lib/errors";

/**
 * What went wrong, from the shape of the thing thrown or returned by supabase-js, PostgREST or fetch. Only the
 * numeric status, the machine `code`, the error `name` and (for matching only) a lowercase copy of the message are
 * read. The message is never passed on.
 */
export type ErrorKind =
  | "disabled"
  | "captcha"
  | "rate_limited"
  | "email_rate_limited"
  | "network"
  | "server"
  | "jwt_expired"
  | "refresh_failed"
  | "unauthorized"
  | "forbidden"
  | "consent"
  | "unique"
  | "foreign_key"
  | "check"
  | "email_exists"
  | "invalid_credentials"
  | "weak_password"
  | "same_password"
  | "email_not_confirmed"
  | "unknown";

const KIND_BY_CODE = new Map<string, ErrorKind>(Object.entries({
  anonymous_provider_disabled: "disabled",
  captcha_failed: "captcha",
  over_request_rate_limit: "rate_limited",
  over_email_send_rate_limit: "email_rate_limited",
  over_sms_send_rate_limit: "email_rate_limited",
  refresh_token_already_used: "refresh_failed",
  refresh_token_not_found: "refresh_failed",
  session_not_found: "refresh_failed",
  session_expired: "refresh_failed",
  bad_jwt: "jwt_expired",
  PGRST301: "jwt_expired",
  PGRST303: "jwt_expired",
  user_not_found: "unauthorized",
  email_exists: "email_exists",
  user_already_exists: "email_exists",
  identity_already_exists: "email_exists",
  invalid_credentials: "invalid_credentials",
  weak_password: "weak_password",
  same_password: "same_password",
  email_not_confirmed: "email_not_confirmed",
  "42501": "consent",
  "23505": "unique",
  "23503": "foreign_key",
  "23514": "check",
} satisfies Record<string, ErrorKind>));

const KIND_BY_NAME = new Map<string, ErrorKind>(Object.entries({
  AuthRetryableFetchError: "network",
  AuthSessionMissingError: "unauthorized",
  AbortError: "network",
  TimeoutError: "network",
} satisfies Record<string, ErrorKind>));

const MESSAGE_PATTERNS: ReadonlyArray<readonly [RegExp, ErrorKind]> = [
  [/jwt expired/, "jwt_expired"],
  [/invalid refresh token|refresh token (?:not found|already used)/, "refresh_failed"],
  [/anonymous sign-?ins are disabled/, "disabled"],
  [/captcha/, "captcha"],
  [/invalid login credentials/, "invalid_credentials"],
  [/email not confirmed/, "email_not_confirmed"],
  [/failed to fetch|fetch failed|networkerror|network request failed|load failed/, "network"],
];

export function classifyError(e: unknown): ErrorKind {
  if (typeof e !== "object" || e === null) return "unknown";
  const o = e as { status?: unknown; code?: unknown; name?: unknown; message?: unknown };
  const byCode = typeof o.code === "string" ? KIND_BY_CODE.get(o.code) : undefined;
  if (byCode) return byCode;
  const byName = typeof o.name === "string" ? KIND_BY_NAME.get(o.name) : undefined;
  if (byName) return byName;
  const message = typeof o.message === "string" ? o.message.toLowerCase() : "";
  for (const [pattern, kind] of MESSAGE_PATTERNS) if (pattern.test(message)) return kind;
  const status = typeof o.status === "number" ? o.status : undefined;
  if (status === 429) return "rate_limited";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 0) return "network";
  if (status !== undefined && status >= 500) return "server";
  return "unknown";
}

/**
 * Faults worth another attempt (08 section 4.1): the network and a failing server. Never a 4xx the caller caused, and
 * never a rate limit: Auth's limit for anonymous sign-ins is per address and lasts an hour, so trying again at once
 * only spends more of a shared allowance.
 */
export const isRetryable = (kind: ErrorKind): boolean => kind === "network" || kind === "server";

type Mapped = { code: AppErrorCode | "consent_required"; message: string };

/** One literal sentence each, 15 words or fewer, no idioms. Checked by a test with the project's literal lint. */
const BY_KIND: Record<ErrorKind, Mapped> = {
  disabled: { code: "store_unavailable", message: "Saving is paused, and your work is on this device." },
  captcha: { code: "forbidden", message: "The safety check failed, so saving is paused on this device." },
  rate_limited: { code: "rate_limited", message: "Saving is paused for a while, and your work is on this device." },
  email_rate_limited: { code: "rate_limited", message: "Email links are limited for everyone right now, so try again in an hour." },
  network: { code: "store_unavailable", message: "I could not reach the server, so your work stays on this device." },
  server: { code: "store_unavailable", message: "The server had a problem, so your work stays on this device." },
  jwt_expired: { code: "unauthorized", message: "Your sign-in ended, so saving is paused on this device." },
  refresh_failed: { code: "unauthorized", message: "Your sign-in could not be renewed, so saving is paused." },
  unauthorized: { code: "unauthorized", message: "You are not signed in, so saving is paused on this device." },
  forbidden: { code: "forbidden", message: "That was not allowed, so nothing was saved." },
  consent: { code: "consent_required", message: "Saving to the cloud is off, so this stays on this device." },
  unique: { code: "conflict", message: "That is already saved." },
  foreign_key: { code: "conflict", message: "The item it belongs to is gone, so it was not saved." },
  check: { code: "bad_input", message: "That value is not allowed, so it was not saved." },
  email_exists: { code: "bad_input", message: "That email could not be used." },
  invalid_credentials: { code: "unauthorized", message: "That email or password is not right." },
  weak_password: { code: "bad_input", message: "Choose a stronger password with at least 8 characters." },
  same_password: { code: "bad_input", message: "Choose a password you have not used before." },
  email_not_confirmed: { code: "unauthorized", message: "Your email is not confirmed yet, so check your inbox." },
  unknown: { code: "internal", message: "Something went wrong on our side, so try again later." },
};

/** Never throws and never returns text from the error itself. */
export const mapSupabaseError = (e: unknown): Mapped => BY_KIND[classifyError(e)];

const FORM_DEFAULT = "Something went wrong on our side, so try again later.";

/** Sentences for the log-in and sign-up forms, where "saving is paused" would be the wrong thing to say. */
const FORM_BY_KIND: Partial<Record<ErrorKind, string>> = {
  invalid_credentials: BY_KIND.invalid_credentials.message,
  weak_password: BY_KIND.weak_password.message,
  same_password: BY_KIND.same_password.message,
  email_not_confirmed: BY_KIND.email_not_confirmed.message,
  // Does not confirm that an address has an account.
  email_exists: "Check your email, or try signing in.",
  rate_limited: "There were too many tries, so wait a while and try again.",
  email_rate_limited: "Too many emails were sent, so try again in an hour.",
  network: "I could not reach the server, so try again later.",
  captcha: "The safety check failed, so try again.",
};

/** One literal sentence for a failed log-in or sign-up. Never throws and never returns text from the error itself. */
export const mapAuthFormError = (e: unknown): string => FORM_BY_KIND[classifyError(e)] ?? FORM_DEFAULT;
