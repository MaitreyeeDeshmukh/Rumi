import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthController, type AuthClientLike, type AuthDeps } from "@/features/auth/authController";
import { APP_ROUTES, isAppPath, safeNext, signInUrl } from "@/lib/auth/gate";
import { routeAuth } from "@/lib/auth/routeAuth";
import { runTask } from "@/lib/ai/harness";
import { createRateLimiter } from "@/lib/security/rateLimit";
import { createTtsHandler } from "@/lib/voice/ttsHandler";
import { bodyOf, fakeProvider, fakeTask, okBody, post, quietClassifier, say } from "./helpers/fakeTask";

const server = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: () => Promise.resolve({ auth: { getUser: server.getUser } }) }));

const UID = "00000000-0000-4000-8000-0000000000aa";
const signedIn = (isAnonymous: boolean) => server.getUser.mockResolvedValue({ data: { user: { id: UID, is_anonymous: isAnonymous } }, error: null });
const withCookie = { cookie: "sb-project-auth-token=abc" };

beforeEach(() => {
  server.getUser.mockReset().mockResolvedValue({ data: { user: null }, error: null });
  // Required mode is the default: the escape hatch is off, and MOCK_AI is off.
  vi.stubEnv("NEXT_PUBLIC_AUTH_OPTIONAL", "");
  vi.stubEnv("MOCK_AI", "");
  vi.stubEnv("SESSION_SECRET", "x".repeat(40));
});
afterEach(() => vi.unstubAllEnvs());

describe("return path (?next=)", () => {
  it.each(["/home", "/practice?item=2", "/kit#top"])("keeps the same-site path %s", (p) => expect(safeNext(p)).toBe(p));
  it.each([null, undefined, "", "home", "//evil.test", "///evil.test/x", "https://evil.test", "/\\evil.test", "/\\/evil.test", "javascript:alert(1)", "/a\nb", "/sign-in", "/sign-in?next=/home", "/login", "/login?next=/home", "/signup", "/forgot-password", "/auth/callback", `/${"a".repeat(600)}`])(
    "refuses %j",
    (p) => expect(safeNext(p)).toBeNull(),
  );
  it("signInUrl carries a safe path and drops an unsafe one", () => {
    expect(signInUrl("/settings?x=1")).toBe("/login?next=%2Fsettings%3Fx%3D1");
    expect(signInUrl("//evil.test")).toBe("/login");
  });
  it("APP_ROUTES lists exactly the folders of the (app) route group", () => {
    const dirs = readdirSync(join(__dirname, "../../src/app/(app)"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `/${d.name}`);
    expect([...APP_ROUTES].sort()).toEqual(dirs.sort());
    expect(isAppPath("/home")).toBe(true);
    expect(isAppPath("/kit/abc")).toBe(true);
    expect(["/", "/login", "/signup", "/forgot-password", "/sign-in", "/privacy", "/safety", "/accessibility", "/help", "/homework"].some(isAppPath)).toBe(false);
  });
});

describe("AI and voice routes need a signed-in email user", () => {
  const harnessDeps = () => ({ provider: quietClassifier(fakeProvider([say("ok")])), limiter: createRateLimiter() });
  const png = () => Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }));
  const tts = () => createTtsHandler({ fetchFn: png as unknown as typeof fetch, limiter: createRateLimiter() });
  const ttsReq = (headers: Record<string, string> = {}) =>
    new Request("https://rumi.test/api/voice/tts", { method: "POST", headers: { origin: "https://rumi.test", "content-type": "application/json", ...headers }, body: JSON.stringify({ text: "Hello" }) });

  it("harness: signed out gets the fixed 401 body and no model call", async () => {
    const { spec, log } = fakeTask();
    const provider = fakeProvider([say("x")]);
    const res = await runTask(spec, post(okBody(), withCookie), { provider, limiter: createRateLimiter() });
    expect(res.status).toBe(401);
    expect(await bodyOf(res)).toMatchObject({ error: { code: "unauthorized" } });
    expect(log).toEqual([]);
    expect(provider.calls).toHaveLength(0);
  });

  it("harness: a guest (anonymous) session is refused, an email user is served", async () => {
    signedIn(true);
    expect((await runTask(fakeTask().spec, post(okBody(), withCookie), harnessDeps())).status).toBe(401);
    signedIn(false);
    expect((await runTask(fakeTask().spec, post(okBody(), withCookie), harnessDeps())).status).toBe(200);
  });

  it("harness: Auth being down is a 503, not 'signed out'", async () => {
    server.getUser.mockRejectedValue(new Error("down"));
    expect((await runTask(fakeTask().spec, post(okBody(), withCookie), harnessDeps())).status).toBe(503);
  });

  it("tts: signed out and guest are refused, an email user is served", async () => {
    expect((await tts()(ttsReq())).status).toBe(401);
    signedIn(true);
    expect((await tts()(ttsReq(withCookie))).status).toBe(401);
    signedIn(false);
    expect((await tts()(ttsReq(withCookie))).status).not.toBe(401);
  });

  it("escape hatch NEXT_PUBLIC_AUTH_OPTIONAL=1 skips the lookup (today's behaviour)", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_OPTIONAL", "1");
    expect(routeAuth()).toEqual({ authenticate: null });
    expect((await runTask(fakeTask().spec, post(okBody()), harnessDeps())).status).toBe(200);
    expect(server.getUser).not.toHaveBeenCalled();
  });

  it("a plain local MOCK_AI run needs no Supabase; MOCK_AI on a deployment still needs a user", () => {
    vi.stubEnv("MOCK_AI", "1");
    expect(routeAuth()).toEqual({ authenticate: null });
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(routeAuth().requireAuth).toBe(true);
  });
});

describe("controller when sign-up is required", () => {
  function setup(allowAnonymous: boolean) {
    const auth = {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signInAnonymously: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      updateUser: vi.fn(),
    };
    let sent: number | null = null;
    let t = 1_000_000;
    const deps: AuthDeps = {
      getClient: () => ({ auth }) as unknown as AuthClientLike,
      isOnline: () => true,
      onNetworkChange: () => () => undefined,
      sleep: () => Promise.resolve(),
      random: () => 0.5,
      now: () => t,
      emailSentAt: { get: () => sent, set: (x) => void (sent = x) },
      lastUser: { get: () => null, set: () => undefined },
      redirectTo: () => "https://rumi.test",
      allowAnonymous: () => allowAnonymous,
    };
    return { auth, controller: createAuthController(deps), tick: (ms: number) => void (t += ms) };
  }

  it("never signs in anonymously, not on start and not on ensureSignedIn", async () => {
    const s = setup(false);
    const stop = s.controller.start();
    await vi.waitFor(() => expect(s.controller.getState().status).toBe("signed_out"));
    expect((await s.controller.ensureSignedIn()).status).toBe("signed_out");
    expect(s.auth.signInAnonymously).not.toHaveBeenCalled();
    stop();
  });

  it("escape hatch: ensureSignedIn still signs in anonymously", async () => {
    const s = setup(true);
    s.auth.signInAnonymously.mockResolvedValue({ data: { session: { user: { id: UID, is_anonymous: true } } }, error: null });
    s.controller.start();
    await s.controller.ensureSignedIn();
    expect(s.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });
});
