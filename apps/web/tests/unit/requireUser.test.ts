import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUser } from "@/lib/auth/requireUser";
import { AppError } from "@/lib/errors";

const UID = "00000000-0000-4000-8000-0000000000aa";
const FORGED = "00000000-0000-4000-8000-0000000000ff";

const server = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(() => {
    throw new Error("getSession must never be used to identify a caller");
  }),
  getServerClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: server.getServerClient }));

const req = (headers: Record<string, string> = {}): Request => new Request("https://rumi.test/api/plan", { method: "POST", headers, body: JSON.stringify({ userId: FORGED }) });

const fail = async (r: Request): Promise<AppError> => {
  const e = await requireUser(r).then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(AppError);
  return e as AppError;
};

beforeEach(() => {
  server.getUser.mockReset();
  server.getServerClient.mockReset().mockResolvedValue({ auth: { getUser: server.getUser, getSession: server.getSession } });
});

describe("requireUser", () => {
  it("returns the id the Auth server verified, a 16 hex hash of it, and the anonymous flag", async () => {
    server.getUser.mockResolvedValue({ data: { user: { id: UID, is_anonymous: true } }, error: null });
    const r = req();
    const u = await requireUser(r);
    expect(u.userId).toBe(UID);
    expect(u.userHash).toMatch(/^[0-9a-f]{16}$/);
    expect(u.isAnonymous).toBe(true);
    expect(server.getServerClient).toHaveBeenCalledWith(r);
    expect(server.getSession).not.toHaveBeenCalled();
  });

  it("a user with an email is not anonymous; a missing flag counts as not anonymous", async () => {
    server.getUser.mockResolvedValue({ data: { user: { id: UID, is_anonymous: false } }, error: null });
    expect((await requireUser(req())).isAnonymous).toBe(false);
    server.getUser.mockResolvedValue({ data: { user: { id: UID } }, error: null });
    expect((await requireUser(req())).isAnonymous).toBe(false);
  });

  it("ignores any user id the client sends in a header or the body", async () => {
    server.getUser.mockResolvedValue({ data: { user: { id: UID, is_anonymous: true } }, error: null });
    const u = await requireUser(req({ "x-user-id": FORGED, "x-rumi-user": FORGED, authorization: `Bearer ${FORGED}` }));
    expect(u.userId).toBe(UID);
  });

  it("no session at all: 401", async () => {
    server.getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    const e = await fail(req());
    expect([e.status, e.code]).toEqual([401, "unauthorized"]);
  });

  it("a forged or expired token: 401 and no user", async () => {
    for (const error of [new AuthApiError("invalid claim: missing sub claim", 403, "bad_jwt"), new AuthApiError("JWT expired", 401, "bad_jwt"), new AuthApiError("User from sub claim in JWT does not exist", 403, "user_not_found")]) {
      server.getUser.mockResolvedValue({ data: { user: null }, error });
      const e = await fail(req());
      expect([e.status, e.code]).toEqual([401, "unauthorized"]);
    }
  });

  it("no error and no user: 401", async () => {
    server.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await fail(req())).status).toBe(401);
  });

  it("an unreachable or failing Auth server is 503, never 'signed out'", async () => {
    for (const error of [new AuthRetryableFetchError("fetch failed", 0), new AuthApiError("upstream", 502, "unexpected_failure")]) {
      server.getUser.mockResolvedValue({ data: { user: null }, error });
      const e = await fail(req());
      expect([e.status, e.code]).toEqual([503, "store_unavailable"]);
    }
  });

  it("a throw from the client is 503 with the cause kept and no text copied into the error", async () => {
    server.getUser.mockRejectedValue(new Error("secret socket detail"));
    const e = await fail(req());
    expect([e.status, e.code, e.message]).toEqual([503, "store_unavailable", "store_unavailable"]);
    expect((e.cause as Error).message).toBe("secret socket detail");
  });

  it("a client that cannot be built (not configured) fails with the config error from getServerClient", async () => {
    server.getServerClient.mockRejectedValue(new AppError("config"));
    expect((await fail(req())).code).toBe("config");
  });
});
