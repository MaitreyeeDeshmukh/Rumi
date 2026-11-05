/**
 * A scripted Supabase for browser tests. It answers the auth and REST calls the app makes, records them, and can be switched
 * to the failure modes the app must survive. Nothing leaves the machine: the URL is the placeholder host the CI build uses.
 */
import type { BrowserContext, Route } from "@playwright/test";

export const SUPABASE_HOST = "rumi-ci.supabase.test";
const ORIGIN = `https://${SUPABASE_HOST}`;
export const USER_ID = "11111111-2222-4333-8444-555555555555";

export type AuthMode = "ok" | "anonymous_disabled" | "rate_limited" | "down";

export interface Call {
  method: string;
  path: string;
  /** The `authorization` header, so a test can see which key or token the browser used. */
  authorization: string | null;
  body: string | null;
}

export interface Mock {
  calls: Call[];
  /** Change how sign-in answers from now on. */
  authMode: AuthMode;
  /** When true every REST call fails like an unreachable host; auth keeps answering. */
  restDown: boolean;
  /** Calls whose path starts with the prefix, for example `/rest/v1/`. */
  to(prefix: string): Call[];
}

const b64 = (o: object): string => Buffer.from(JSON.stringify(o)).toString("base64url");

/** An unsigned JWT with an expiry an hour away: enough for supabase-js, which only reads it. */
export function fakeAccessToken(): string {
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER_ID, role: "authenticated", is_anonymous: true, exp: Math.floor(Date.now() / 1000) + 3600 })}.c2lnbmF0dXJl`;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "access-control-expose-headers": "*",
};
const json = (route: Route, status: number, body: unknown): Promise<void> =>
  route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });

export async function mockSupabase(context: BrowserContext): Promise<Mock> {
  const mock: Mock = { calls: [], authMode: "ok", restDown: false, to: (p) => mock.calls.filter((c) => c.path.startsWith(p)) };

  await context.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    mock.calls.push({ method: req.method(), path: url.pathname, authorization: req.headers()["authorization"] ?? null, body: req.postData() });

    if (url.pathname.startsWith("/auth/v1/")) {
      if (mock.authMode === "down") return route.abort("connectionrefused");
      if (mock.authMode === "rate_limited") return json(route, 429, { code: 429, error_code: "over_request_rate_limit", msg: "rate limit" });
      if (mock.authMode === "anonymous_disabled") return json(route, 422, { code: 422, error_code: "anonymous_provider_disabled", msg: "Anonymous sign-ins are disabled" });
      if (url.pathname === "/auth/v1/signup" || url.pathname === "/auth/v1/token") {
        return json(route, 200, {
          access_token: fakeAccessToken(),
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: "refresh-token-for-tests",
          user: { id: USER_ID, aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
        });
      }
      if (url.pathname === "/auth/v1/user") return json(route, 200, { id: USER_ID, aud: "authenticated", role: "authenticated", is_anonymous: true });
      return json(route, 200, {});
    }
    if (mock.restDown) return route.abort("connectionrefused");
    if (url.pathname.startsWith("/rest/v1/rpc/")) return json(route, 200, 1);
    return json(route, req.method() === "GET" ? 200 : 201, []);
  });
  return mock;
}
