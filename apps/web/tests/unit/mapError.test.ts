import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { classifyError, isRetryable, mapAuthFormError, mapSupabaseError } from "@/features/auth/mapError";
import { countWords, literalLint } from "@/lib/literalLint";

const pg = (code: string, message = "raw database text with secret-row-42"): { code: string; message: string } => ({ code, message });

describe("mapSupabaseError", () => {
  it.each([
    ["HTTP 401", { status: 401, message: "x" }, "unauthorized"],
    ["HTTP 403", { status: 403, message: "x" }, "forbidden"],
    ["HTTP 429", { status: 429, message: "x" }, "rate_limited"],
    ["HTTP 500", { status: 500, message: "x" }, "store_unavailable"],
    ["HTTP 503", { status: 503, message: "x" }, "store_unavailable"],
    ["PG 42501 (row level security: no consent)", pg("42501"), "consent_required"],
    ["PG 23505 (duplicate)", pg("23505"), "conflict"],
    ["PG 23503 (missing parent)", pg("23503"), "conflict"],
    ["PG 23514 (check failed)", pg("23514"), "bad_input"],
    ["network failure (fetch)", new TypeError("Failed to fetch"), "store_unavailable"],
    ["network failure (node)", new TypeError("fetch failed"), "store_unavailable"],
    ["retryable auth fetch error", new AuthRetryableFetchError("x", 0), "store_unavailable"],
    ["request timed out", Object.assign(new Error("x"), { name: "TimeoutError" }), "store_unavailable"],
    ["JWT expired (message)", { message: "JWT expired" }, "unauthorized"],
    ["JWT expired (code)", new AuthApiError("x", 401, "bad_jwt"), "unauthorized"],
    ["PostgREST JWT expired", pg("PGRST301"), "unauthorized"],
    ["refresh token reused", new AuthApiError("x", 400, "refresh_token_already_used"), "unauthorized"],
    ["refresh token missing", { message: "Invalid Refresh Token: Refresh Token Not Found" }, "unauthorized"],
    ["session missing", new AuthSessionMissingError(), "unauthorized"],
    ["captcha failed", new AuthApiError("x", 400, "captcha_failed"), "forbidden"],
    ["captcha failed (message only)", { message: "captcha verification process failed" }, "forbidden"],
    ["anonymous sign-ins disabled", new AuthApiError("x", 422, "anonymous_provider_disabled"), "store_unavailable"],
    ["anonymous sign-ins disabled (message only)", { message: "Anonymous sign-ins are disabled" }, "store_unavailable"],
    ["email rate limit", new AuthApiError("x", 429, "over_email_send_rate_limit"), "rate_limited"],
    ["anything else", { message: "boom" }, "internal"],
    ["a string", "boom", "internal"],
    ["null", null, "internal"],
    ["undefined", undefined, "internal"],
  ])("%s -> %s", (_label, input, code) => {
    expect(mapSupabaseError(input).code).toBe(code);
  });

  it("every sentence is one literal sentence of 15 words or fewer, with no idiom", () => {
    const inputs: unknown[] = [
      { status: 401 }, { status: 403 }, { status: 429 }, { status: 500 }, pg("42501"), pg("23505"), pg("23503"), pg("23514"),
      new TypeError("Failed to fetch"), { message: "JWT expired" }, { message: "Invalid Refresh Token" }, { message: "captcha" },
      new AuthApiError("x", 429, "over_email_send_rate_limit"),
      { message: "Anonymous sign-ins are disabled" }, new AuthApiError("x", 400, "email_exists"), "boom",
    ];
    for (const input of inputs) {
      const { message } = mapSupabaseError(input);
      expect({ message, words: countWords(message) <= 15 }).toEqual({ message, words: true });
      expect(message.match(/[.!?]/g)).toHaveLength(1);
      expect(message.endsWith(".")).toBe(true);
      expect({ message, lint: literalLint(message).ok }).toEqual({ message, lint: true });
    }
  });

  it("rate limits never promise 'one minute': Auth's limits last an hour or are shared", () => {
    for (const input of [{ status: 429 }, new AuthApiError("x", 429, "over_request_rate_limit"), new AuthApiError("x", 429, "over_email_send_rate_limit")]) {
      expect(mapSupabaseError(input).message).not.toMatch(/minute/i);
      expect(mapSupabaseError(input).code).toBe("rate_limited");
    }
    expect(mapSupabaseError({ status: 429 }).message).toBe("Saving is paused for a while, and your work is on this device.");
    expect(mapSupabaseError(new AuthApiError("x", 429, "over_email_send_rate_limit")).message).toContain("for everyone");
  });

  it("never returns text taken from the error", () => {
    const secret = "secret-row-42 user text 602-555-0100";
    for (const input of [pg("42501", secret), pg("23505", secret), { status: 500, message: secret }, new TypeError(secret), { message: `JWT expired ${secret}` }]) {
      expect(JSON.stringify(mapSupabaseError(input))).not.toContain("secret-row-42");
      expect(JSON.stringify(mapSupabaseError(input))).not.toContain("602");
    }
  });

  it("does not treat Object.prototype names as known codes", () => {
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(mapSupabaseError({ code: key, name: key }).code).toBe("internal");
    }
  });

  it("code and name win over a misleading message", () => {
    expect(classifyError({ code: "23505", message: "JWT expired" })).toBe("unique");
  });
});

describe("isRetryable", () => {
  it("retries only the network and server faults, never a caller fault or a rate limit", () => {
    const retry = ["network", "server"] as const;
    const noRetry = ["rate_limited", "email_rate_limited", "disabled", "captcha", "jwt_expired", "refresh_failed", "unauthorized", "forbidden", "consent", "unique", "foreign_key", "check", "email_exists", "unknown"] as const;
    for (const k of retry) expect(isRetryable(k)).toBe(true);
    for (const k of noRetry) expect(isRetryable(k)).toBe(false);
  });
});

describe("mapAuthFormError", () => {
  it.each([
    ["invalid_credentials code", new AuthApiError("x", 400, "invalid_credentials"), "That email or password is not right."],
    ["invalid login (message only)", { message: "Invalid login credentials" }, "That email or password is not right."],
    ["weak_password", new AuthApiError("x", 422, "weak_password"), "Choose a stronger password with at least 8 characters."],
    ["email_not_confirmed", new AuthApiError("x", 400, "email_not_confirmed"), "Your email is not confirmed yet, so check your inbox."],
    ["user_already_exists", new AuthApiError("x", 422, "user_already_exists"), "Check your email, or try signing in."],
    ["email_exists", new AuthApiError("x", 422, "email_exists"), "Check your email, or try signing in."],
    ["over_request_rate_limit", new AuthApiError("x", 429, "over_request_rate_limit"), "There were too many tries, so wait a while and try again."],
    ["over_email_send_rate_limit", new AuthApiError("x", 429, "over_email_send_rate_limit"), "Too many emails were sent, so try again in an hour."],
    ["network", new TypeError("Failed to fetch"), "I could not reach the server, so try again later."],
    ["retryable fetch error", new AuthRetryableFetchError("x", 0), "I could not reach the server, so try again later."],
    ["captcha", new AuthApiError("x", 400, "captcha_failed"), "The safety check failed, so try again."],
    ["anything else", { message: "boom" }, "Something went wrong on our side, so try again later."],
    ["null", null, "Something went wrong on our side, so try again later."],
  ])("%s", (_label, input, message) => {
    expect(mapAuthFormError(input)).toBe(message);
  });

  it("every form sentence is one literal sentence of 15 words or fewer, and none repeats the error text", () => {
    const secret = "hunter2-secret@example.test";
    const inputs: unknown[] = ["invalid_credentials", "weak_password", "email_not_confirmed", "email_exists", "user_already_exists", "over_request_rate_limit", "over_email_send_rate_limit", "captcha_failed"].map((code) => new AuthApiError(secret, 400, code));
    inputs.push(new TypeError("Failed to fetch"), { message: "boom" });
    for (const input of inputs) {
      const message = mapAuthFormError(input);
      expect({ message, words: countWords(message) <= 15 }).toEqual({ message, words: true });
      expect(message.match(/[.!?]/g)).toHaveLength(1);
      expect({ message, lint: literalLint(message).ok }).toEqual({ message, lint: true });
      expect(message).not.toContain("hunter2");
    }
  });
});
