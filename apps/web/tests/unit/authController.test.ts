import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createAuthController, EMAIL_COOLDOWN_MS, MAX_SIGN_IN_TRIES, RETRY_COOLDOWN_MS, type AuthClientLike, type AuthDeps } from "@/features/auth/authController";

const ME = "00000000-0000-4000-8000-0000000000aa";
const OLD = "00000000-0000-4000-8000-0000000000bb";

type Listener = (event: string, session: { user: { id: string; is_anonymous?: boolean } } | null) => void;
type Reply = { data: { session: { user: { id: string; is_anonymous: boolean } } | null }; error: unknown };

const signedIn = (id = ME): Reply => ({ data: { session: { user: { id, is_anonymous: true } } }, error: null });
const failedWith = (error: unknown): Reply => ({ data: { session: null }, error });

function setup(options: { session?: { user: { id: string; is_anonymous?: boolean } } | null; signIns?: Array<Reply | Error>; online?: boolean; last?: string | null; captcha?: string | undefined; configured?: boolean; rpc?: () => unknown } = {}) {
  let online = options.online ?? true;
  let last = options.last ?? null;
  let clock = 1_000_000;
  let emailAt: number | null = null;
  const signInQueue = [...(options.signIns ?? [signedIn()])];
  const listeners: Listener[] = [];
  let netHandler: ((online: boolean) => void) | undefined;
  const auth = {
    getSession: vi.fn(() => Promise.resolve({ data: { session: options.session ?? null }, error: null })),
    signInAnonymously: vi.fn(() => {
      const next = signInQueue.length > 1 ? signInQueue.shift() : signInQueue[0];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next as Reply);
    }),
    onAuthStateChange: vi.fn((cb: Listener) => {
      listeners.push(cb);
      return { data: { subscription: { unsubscribe: vi.fn(() => listeners.splice(listeners.indexOf(cb), 1)) } } };
    }),
    updateUser: vi.fn(() => Promise.resolve({ data: {}, error: null as unknown })),
  };
  const rpc = vi.fn(options.rpc ?? (() => Promise.resolve({ data: null, error: null })));
  const onEnsureRowsFailed = vi.fn();
  const sleeps: number[] = [];
  const deps: AuthDeps = {
    getClient: () => {
      if (options.configured === false) throw new Error("supabase_not_configured");
      return { auth, rpc } as unknown as AuthClientLike;
    },
    isOnline: () => online,
    onNetworkChange: (h) => ((netHandler = h), () => (netHandler = undefined)),
    sleep: (ms) => (sleeps.push(ms), Promise.resolve()),
    random: () => 0.5,
    now: () => clock,
    emailSentAt: { get: () => emailAt, set: (t) => (emailAt = t) },
    lastUser: { get: () => last, set: (id) => (last = id) },
    getCaptchaToken: options.captcha === undefined ? undefined : () => Promise.resolve(options.captcha),
    redirectTo: () => "https://rumi.test",
    onEnsureRowsFailed,
  };
  const controller = createAuthController(deps);
  return {
    controller,
    auth,
    rpc,
    onEnsureRowsFailed,
    sleeps,
    emit: (event: string, session: Parameters<Listener>[1]) => listeners.slice().forEach((l) => l(event, session)),
    network: (value: boolean) => ((online = value), netHandler?.(value)),
    setOnline: (value: boolean) => (online = value),
    last: () => last,
    tick: (ms: number) => (clock += ms),
    emailAt: () => emailAt,
    listenerCount: () => listeners.length,
  };
}

/** Lets pending promise callbacks run. The controller has no timers of its own (sleep is injected). */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
/** What a screen that needs the cloud does: start (restore), then ask for a sign-in. Most of this file tests the sign-in itself. */
const started = async (s: ReturnType<typeof setup>) => {
  const stop = s.controller.start();
  await s.controller.ensureSignedIn();
  await settle();
  return stop;
};
/** What every page does on load: start and nothing else. */
const loaded = async (s: ReturnType<typeof setup>) => {
  const stop = s.controller.start();
  await settle();
  return stop;
};

describe("sign-in", () => {
  it("starts as signing_in and never blocks: start() returns at once", () => {
    const s = setup();
    expect(s.controller.getState().status).toBe("signing_in");
    s.controller.start();
    expect(s.controller.getState().status).toBe("signing_in");
  });

  it("signs in anonymously once and becomes ready with the id and the anonymous flag", async () => {
    const s = setup();
    await started(s);
    expect(s.controller.getState()).toMatchObject({ status: "ready", userId: ME, isAnonymous: true, identityReset: false });
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(s.last()).toBe(ME);
  });

  it("reuses a session already in this browser instead of making a new identity", async () => {
    const s = setup({ session: { user: { id: ME, is_anonymous: false } } });
    await started(s);
    expect(s.controller.getState()).toMatchObject({ status: "ready", userId: ME, isAnonymous: false });
    expect(s.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("anonymous sign-ins disabled: degraded at once, no retry", async () => {
    const s = setup({ signIns: [failedWith(new AuthApiError("Anonymous sign-ins are disabled", 422, "anonymous_provider_disabled"))] });
    await started(s);
    expect(s.controller.getState()).toMatchObject({ status: "degraded", userId: null });
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(s.sleeps).toEqual([]);
  });

  it("captcha failure: degraded at once, no retry; a captcha token is passed to the sign-in", async () => {
    const s = setup({ captcha: "tok-123", signIns: [failedWith(new AuthApiError("captcha verification process failed", 400, "captcha_failed"))] });
    await started(s);
    expect(s.controller.getState().status).toBe("degraded");
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(s.auth.signInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: "tok-123" } });
  });

  it("rate limited (429): one attempt only, no backoff, degraded (the limit is per address and lasts an hour)", async () => {
    const s = setup({ signIns: [failedWith(new AuthApiError("rate limit", 429, "over_request_rate_limit"))] });
    await started(s);
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(s.sleeps).toEqual([]);
    expect(s.controller.getState().status).toBe("degraded");
  });

  it("a network fault is retried MAX_SIGN_IN_TRIES times with jittered, growing backoff, then degraded", async () => {
    const s = setup({ signIns: [failedWith(new AuthRetryableFetchError("fetch failed", 0))] });
    await started(s);
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(MAX_SIGN_IN_TRIES);
    expect(MAX_SIGN_IN_TRIES).toBe(3);
    // random() = 0.5 gives a factor of 0.75: 500 * 0.75 and 1000 * 0.75.
    expect(s.sleeps).toEqual([375, 750]);
    expect(s.controller.getState().status).toBe("degraded");
  });

  it("the jitter really varies the wait (it is not a fixed delay)", async () => {
    const lows = setup({ signIns: [failedWith(new AuthRetryableFetchError("x", 0))] });
    await started(lows);
    expect(lows.sleeps[0]).toBeGreaterThanOrEqual(250);
    expect(lows.sleeps[0]).toBeLessThanOrEqual(500);
  });

  it("a server fault or a network fault is retried and the second try can succeed", async () => {
    for (const error of [new AuthApiError("upstream", 502, "unexpected_failure"), new AuthRetryableFetchError("fetch failed", 0)]) {
      const s = setup({ signIns: [failedWith(error), signedIn()] });
      await started(s);
      expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(2);
      expect(s.controller.getState().status).toBe("ready");
    }
  });

  it("a thrown fault never escapes: the status becomes degraded", async () => {
    const s = setup({ signIns: [new TypeError("Failed to fetch")] });
    await started(s);
    expect(s.controller.getState().status).toBe("degraded");
  });

  it("Supabase not configured: degraded, no throw", async () => {
    const s = setup({ configured: false });
    await expect(started(s)).resolves.toBeTypeOf("function");
    expect(s.controller.getState().status).toBe("degraded");
  });

  it("a fault while the browser went offline reports offline, not degraded, and does not keep retrying", async () => {
    const s = setup({ signIns: [failedWith(new AuthRetryableFetchError("fetch failed", 0))] });
    s.auth.signInAnonymously.mockImplementationOnce(() => {
      s.setOnline(false);
      return Promise.resolve(failedWith(new AuthRetryableFetchError("fetch failed", 0)));
    });
    await started(s);
    expect(s.controller.getState().status).toBe("offline");
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });
});

describe("lazy sign-in: a visit that uses no cloud feature makes no account", () => {
  it("a fresh visit looks for a session and makes NO sign-in call", async () => {
    const s = setup();
    await loaded(s);
    expect(s.auth.getSession).toHaveBeenCalledTimes(1);
    expect(s.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(s.rpc).not.toHaveBeenCalled();
    expect(s.controller.getState()).toMatchObject({ status: "signed_out", userId: null });
  });

  it("an existing session is restored on load, with no sign-in call", async () => {
    const s = setup({ session: { user: { id: ME, is_anonymous: true } } });
    await loaded(s);
    expect(s.controller.getState()).toMatchObject({ status: "ready", userId: ME });
    expect(s.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("the network coming back or going away never signs anyone in by itself", async () => {
    const s = setup();
    await loaded(s);
    s.network(false);
    s.network(true);
    await settle();
    expect(s.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(s.controller.getState().status).toBe("signed_out");
  });

  it("offline at load, then online: still no sign-in unless something asked", async () => {
    const s = setup({ online: false });
    await loaded(s);
    expect(s.controller.getState().status).toBe("offline");
    s.network(true);
    await settle();
    expect(s.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(s.controller.getState().status).toBe("signed_out");
  });

  it("ensureSignedIn signs in anonymously once and answers with the ready state", async () => {
    const s = setup();
    await loaded(s);
    const state = await s.controller.ensureSignedIn();
    expect(state).toMatchObject({ status: "ready", userId: ME, isAnonymous: true });
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: when ready it does nothing, and callers at the same moment share one sign-in", async () => {
    const s = setup();
    await loaded(s);
    const [a, b, c] = await Promise.all([s.controller.ensureSignedIn(), s.controller.ensureSignedIn(), s.controller.ensureSignedIn()]);
    expect([a.status, b.status, c.status]).toEqual(["ready", "ready", "ready"]);
    await s.controller.ensureSignedIn();
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(s.rpc).toHaveBeenCalledTimes(1);
  });

  it("asked for before the first look has finished, it waits for that look and then signs in once", async () => {
    const s = setup();
    s.controller.start();
    const state = await s.controller.ensureSignedIn();
    expect(state.status).toBe("ready");
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("asked for when a session exists, it reuses it and signs nobody in", async () => {
    const s = setup({ session: { user: { id: ME, is_anonymous: true } } });
    s.controller.start();
    expect((await s.controller.ensureSignedIn()).userId).toBe(ME);
    expect(s.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("keeps the retry rules: a network fault is tried MAX_SIGN_IN_TRIES times, then degraded", async () => {
    const s = setup({ signIns: [failedWith(new AuthRetryableFetchError("fetch failed", 0))] });
    await loaded(s);
    expect((await s.controller.ensureSignedIn()).status).toBe("degraded");
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(MAX_SIGN_IN_TRIES);
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("after a failure, asking again is held to the retry cooldown", async () => {
    const s = setup({ signIns: [failedWith(new AuthApiError("x", 429, "over_request_rate_limit"))] });
    await loaded(s);
    await s.controller.ensureSignedIn();
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    await s.controller.ensureSignedIn();
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(2); // the first retry is allowed
    for (let i = 0; i < 5; i++) {
      s.tick(RETRY_COOLDOWN_MS / 10);
      await s.controller.ensureSignedIn();
    }
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(2);
    s.tick(RETRY_COOLDOWN_MS);
    await s.controller.ensureSignedIn();
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(3);
  });

  it("offline when asked: reports offline, and signs in when the network returns because someone asked", async () => {
    const s = setup({ online: false });
    await loaded(s);
    expect((await s.controller.ensureSignedIn()).status).toBe("offline");
    expect(s.auth.signInAnonymously).not.toHaveBeenCalled();
    s.network(true);
    await settle();
    expect(s.controller.getState()).toMatchObject({ status: "ready", userId: ME });
  });

  it("Supabase not configured: ensureSignedIn answers degraded and does not throw", async () => {
    const s = setup({ configured: false });
    await loaded(s);
    await expect(s.controller.ensureSignedIn()).resolves.toMatchObject({ status: "degraded" });
  });
});

describe("core_ensure_my_rows after a new sign-in", () => {
  it("is called once, by name, right after a successful sign-in", async () => {
    const s = setup();
    await started(s);
    expect(s.rpc).toHaveBeenCalledTimes(1);
    expect(s.rpc).toHaveBeenCalledWith("core_ensure_my_rows");
    expect(s.onEnsureRowsFailed).not.toHaveBeenCalled();
  });

  it("is not called for a session that was already in the browser", async () => {
    const s = setup({ session: { user: { id: ME, is_anonymous: true } } });
    await started(s);
    expect(s.rpc).not.toHaveBeenCalled();
  });

  const thrower = (): never => {
    throw new Error("boom");
  };
  it.each([
    ["an error answer", () => Promise.resolve({ data: null, error: { code: "42501" } })],
    ["a rejected call", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a throw", thrower],
  ])("%s is swallowed and counted: the sign-in still succeeds", async (_n, rpc) => {
    const s = setup({ rpc });
    await started(s);
    expect(s.controller.getState().status).toBe("ready");
    expect(s.onEnsureRowsFailed).toHaveBeenCalledTimes(1);
    expect(s.controller.ensureRowsFailures()).toBe(1);
  });

  it("does not wait for it: the state is ready while the call is still pending", async () => {
    const s = setup({ rpc: () => new Promise(() => undefined) });
    await started(s);
    expect(s.controller.getState().status).toBe("ready");
  });
});

describe("offline and online", () => {
  it("starts offline with no network call, and signs in when the network returns", async () => {
    const s = setup({ online: false });
    await started(s);
    expect(s.controller.getState().status).toBe("offline");
    expect(s.auth.getSession).not.toHaveBeenCalled();
    s.network(true);
    await settle();
    expect(s.controller.getState()).toMatchObject({ status: "ready", userId: ME });
  });

  it("losing the network while ready keeps the identity; regaining it is ready again with no new sign-in", async () => {
    const s = setup();
    await started(s);
    s.network(false);
    expect(s.controller.getState()).toMatchObject({ status: "offline", userId: ME });
    s.network(true);
    await settle();
    expect(s.controller.getState()).toMatchObject({ status: "ready", userId: ME });
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("an online event does not disturb a degraded state (disabled provider stays disabled)", async () => {
    const s = setup({ signIns: [failedWith(new AuthApiError("x", 422, "anonymous_provider_disabled"))] });
    await started(s);
    s.network(true);
    await settle();
    expect(s.controller.getState().status).toBe("degraded");
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });
});

describe("retry()", () => {
  it("after degraded, signs in again with a fresh set of tries", async () => {
    const s = setup({ signIns: [failedWith(new AuthApiError("x", 422, "anonymous_provider_disabled")), signedIn()] });
    await started(s);
    expect(s.controller.getState().status).toBe("degraded");
    s.controller.retry();
    await settle();
    expect(s.controller.getState().status).toBe("ready");
  });

  it("accepts one retry per cooldown: a button pressed again and again cannot hammer Auth", async () => {
    const s = setup({ signIns: [failedWith(new AuthApiError("x", 429, "over_request_rate_limit"))] });
    await started(s);
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    s.controller.retry();
    await settle();
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 5; i++) {
      s.tick(RETRY_COOLDOWN_MS / 10);
      s.controller.retry();
      await settle();
    }
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(2);
    s.tick(RETRY_COOLDOWN_MS);
    s.controller.retry();
    await settle();
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(3);
  });

  it("a retry that is refused by the cooldown does not restart the cooldown", async () => {
    const s = setup({ signIns: [failedWith(new AuthApiError("x", 429, "over_request_rate_limit"))] });
    await started(s);
    s.controller.retry();
    await settle();
    s.tick(RETRY_COOLDOWN_MS - 1);
    s.controller.retry();
    await settle();
    s.tick(1);
    s.controller.retry();
    await settle();
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(3);
  });

  it("does nothing when ready, and two quick retries make one sign-in", async () => {
    const s = setup();
    await started(s);
    s.controller.retry();
    await settle();
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    const d = setup({ signIns: [failedWith(new AuthApiError("x", 422, "anonymous_provider_disabled")), signedIn()] });
    await started(d);
    d.controller.retry();
    d.tick(RETRY_COOLDOWN_MS);
    d.controller.retry();
    await settle();
    expect(d.auth.signInAnonymously).toHaveBeenCalledTimes(2);
  });
});

describe("auth events", () => {
  it("SIGNED_OUT (refresh failed, token reuse, signed out elsewhere) goes degraded and keeps the failure visible, nothing else is touched", async () => {
    const s = setup();
    await started(s);
    s.emit("SIGNED_OUT", null);
    expect(s.controller.getState()).toMatchObject({ status: "degraded", userId: null });
  });

  it("SIGNED_OUT during our own sign-in is not the end of it", async () => {
    const s = setup();
    s.auth.getSession.mockImplementationOnce(() => {
      s.emit("SIGNED_OUT", null);
      return Promise.resolve({ data: { session: null }, error: null });
    });
    await started(s);
    expect(s.controller.getState().status).toBe("ready");
  });

  it("TOKEN_REFRESHED, SIGNED_IN and USER_UPDATED update the state; the anonymous flag follows the user", async () => {
    const s = setup();
    await started(s);
    s.emit("USER_UPDATED", { user: { id: ME, is_anonymous: false } });
    expect(s.controller.getState()).toMatchObject({ status: "ready", userId: ME, isAnonymous: false });
    s.emit("SIGNED_OUT", null);
    s.emit("SIGNED_IN", { user: { id: ME, is_anonymous: false } });
    expect(s.controller.getState().status).toBe("ready");
  });

  it("an INITIAL_SESSION event with no session changes nothing", async () => {
    const s = setup({ signIns: [failedWith(new AuthApiError("x", 422, "anonymous_provider_disabled"))] });
    await started(s);
    s.emit("INITIAL_SESSION", null);
    expect(s.controller.getState().status).toBe("degraded");
  });

  it("stopping unsubscribes everything; starting again works (React strict mode)", async () => {
    const s = setup();
    const stop = await started(s);
    stop();
    expect(s.listenerCount()).toBe(0);
    s.emit("SIGNED_OUT", null);
    expect(s.controller.getState().status).toBe("ready");
    s.controller.start();
    await settle();
    expect(s.listenerCount()).toBe(1);
  });
});

describe("storage cleared: a new identity", () => {
  it("flags identityReset when this browser signed in as someone else last time", async () => {
    const s = setup({ last: OLD });
    await started(s);
    expect(s.controller.getState()).toMatchObject({ userId: ME, identityReset: true });
    expect(s.last()).toBe(ME);
  });

  it("does not flag the first visit or the same identity", async () => {
    const first = setup({ last: null });
    await started(first);
    expect(first.controller.getState().identityReset).toBe(false);
    const same = setup({ last: ME, session: { user: { id: ME, is_anonymous: true } } });
    await started(same);
    expect(same.controller.getState().identityReset).toBe(false);
  });

  it("the flag stays set after later events for the new identity", async () => {
    const s = setup({ last: OLD });
    await started(s);
    s.emit("TOKEN_REFRESHED", { user: { id: ME, is_anonymous: true } });
    expect(s.controller.getState().identityReset).toBe(true);
  });
});

describe("subscribe and state identity", () => {
  it("notifies on a change and keeps the same state object when nothing changed", async () => {
    const s = setup();
    const seen = vi.fn();
    const off = s.controller.subscribe(seen);
    await started(s);
    expect(seen).toHaveBeenCalled();
    const before = s.controller.getState();
    s.emit("TOKEN_REFRESHED", { user: { id: ME, is_anonymous: true } });
    expect(s.controller.getState()).toBe(before);
    off();
    seen.mockClear();
    s.emit("SIGNED_OUT", null);
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("upgradeWithEmail", () => {
  it("sends the link: updateUser with the address and the redirect, and reports ok", async () => {
    const s = setup();
    await started(s);
    await expect(s.controller.upgradeWithEmail("  me@example.com ")).resolves.toEqual({ ok: true });
    expect(s.auth.updateUser).toHaveBeenCalledWith({ email: "me@example.com" }, { emailRedirectTo: "https://rumi.test" });
  });

  it.each(["", "plain", "a@b", "a b@c.com", "@c.com", "a@@c.com", "a@c..com", `${"x".repeat(250)}@c.com`])("rejects %j before any network call", async (bad) => {
    const s = setup();
    await started(s);
    const r = await s.controller.upgradeWithEmail(bad);
    expect(r.ok).toBe(false);
    expect(s.auth.updateUser).not.toHaveBeenCalled();
  });

  it("an address that already has an account looks exactly like success", async () => {
    const s = setup();
    await started(s);
    s.auth.updateUser.mockResolvedValueOnce({ data: {}, error: new AuthApiError("A user with this email address has already been registered", 422, "email_exists") });
    const exists = await s.controller.upgradeWithEmail("taken@example.com");
    s.tick(EMAIL_COOLDOWN_MS);
    s.auth.updateUser.mockResolvedValueOnce({ data: {}, error: null });
    const fresh = await s.controller.upgradeWithEmail("new@example.com");
    expect(exists).toEqual(fresh);
  });

  it("maps a rate limit and a thrown fault to a literal sentence and never shows the raw message", async () => {
    const s = setup();
    await started(s);
    s.auth.updateUser.mockResolvedValueOnce({ data: {}, error: new AuthApiError("secret provider text", 429, "over_email_send_rate_limit") });
    const limited = await s.controller.upgradeWithEmail("me@example.com");
    expect(limited.ok).toBe(false);
    expect(JSON.stringify(limited)).toContain("for everyone");
    expect(JSON.stringify(limited)).not.toMatch(/minute/i);
    s.tick(EMAIL_COOLDOWN_MS);
    s.auth.updateUser.mockRejectedValueOnce(new TypeError("Failed to fetch secret"));
    const thrown = await s.controller.upgradeWithEmail("me@example.com");
    expect(thrown.ok).toBe(false);
    expect(JSON.stringify(thrown)).not.toContain("secret");
  });

  it("one link per device per minute: a second request inside the cooldown is refused before any network call, and allowed after it", async () => {
    const s = setup();
    await started(s);
    await expect(s.controller.upgradeWithEmail("me@example.com")).resolves.toEqual({ ok: true });
    const again = await s.controller.upgradeWithEmail("other@example.com");
    expect(again.ok).toBe(false);
    expect(s.auth.updateUser).toHaveBeenCalledTimes(1);
    s.tick(EMAIL_COOLDOWN_MS - 1);
    expect((await s.controller.upgradeWithEmail("me@example.com")).ok).toBe(false);
    s.tick(1);
    await expect(s.controller.upgradeWithEmail("me@example.com")).resolves.toEqual({ ok: true });
    expect(s.auth.updateUser).toHaveBeenCalledTimes(2);
  });

  it("the cooldown is recorded even when the address is already registered, so it cannot be used to probe", async () => {
    const s = setup();
    await started(s);
    s.auth.updateUser.mockResolvedValueOnce({ data: {}, error: new AuthApiError("registered", 422, "email_exists") });
    await s.controller.upgradeWithEmail("taken@example.com");
    expect(s.emailAt()).not.toBeNull();
    expect((await s.controller.upgradeWithEmail("another@example.com")).ok).toBe(false);
  });

  it("an invalid address does not start the cooldown", async () => {
    const s = setup();
    await started(s);
    await s.controller.upgradeWithEmail("not an email");
    expect(s.emailAt()).toBeNull();
  });

  it("is refused while saving is paused, and for an identity that already has an email", async () => {
    const paused = setup({ signIns: [failedWith(new AuthApiError("x", 422, "anonymous_provider_disabled"))] });
    await started(paused);
    expect((await paused.controller.upgradeWithEmail("me@example.com")).ok).toBe(false);
    const upgraded = setup({ session: { user: { id: ME, is_anonymous: false } } });
    await started(upgraded);
    expect((await upgraded.controller.upgradeWithEmail("me@example.com")).ok).toBe(false);
    expect(paused.auth.updateUser).not.toHaveBeenCalled();
    expect(upgraded.auth.updateUser).not.toHaveBeenCalled();
  });
});
