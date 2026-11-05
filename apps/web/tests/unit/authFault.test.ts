import { beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@/lib/log", () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: logs.warn }) }));

beforeEach(() => {
  vi.resetModules();
  logs.warn.mockReset();
});

const ctx = { requestId: "11111111-1111-4111-8111-111111111111", route: "/api/plan" };

describe("noteAuthRateLimited", () => {
  it("logs auth_rate_limited with the code only", async () => {
    const { noteAuthRateLimited } = await import("@/lib/auth/authFault");
    noteAuthRateLimited(ctx, 1_000_000);
    expect(logs.warn).toHaveBeenCalledTimes(1);
    expect(logs.warn).toHaveBeenCalledWith("auth_rate_limited", { code: "rate_limited" });
  });

  it("at most once a minute per instance, then again after the minute", async () => {
    const { noteAuthRateLimited } = await import("@/lib/auth/authFault");
    noteAuthRateLimited(ctx, 1_000_000);
    for (let t = 1; t < 60_000; t += 5_000) noteAuthRateLimited(ctx, 1_000_000 + t);
    expect(logs.warn).toHaveBeenCalledTimes(1);
    noteAuthRateLimited(ctx, 1_060_000);
    expect(logs.warn).toHaveBeenCalledTimes(2);
  });
});
