import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ mode: "ok" as "ok" | "error" | "hang" | "throw", calls: 0, adminTouched: 0 }));
vi.mock("@/lib/supabase/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/admin")>()),
  getAdminClient: () => {
    h.adminTouched++;
    return {
      rpc: (fn: string): PromiseLike<{ error: unknown }> => {
        h.calls++;
        expect(fn).toBe("ops_ai_usage_total");
        if (h.mode === "throw") throw new Error("SECRETHOST unreachable");
        if (h.mode === "hang") return new Promise(() => undefined);
        return Promise.resolve({ error: h.mode === "error" ? { message: "SECRETHOST down" } : null });
      },
    };
  },
}));

import { setLogSink } from "@/lib/ai/telemetry";
import { GET as health } from "@/app/api/health/route";
import { GET as ready } from "@/app/api/ready/route";
import { getRelease, missingEnvNames } from "@/lib/telemetry/config";
import { resetReadyCache } from "@/lib/telemetry/ready";

const lines: string[] = [];
const req = (headers: Record<string, string> = {}) => new Request("https://rumi.example/api/ready", { headers });
const TOKEN = "ready-token-value-0123456789";

beforeEach(() => {
  setLogSink((l) => lines.push(l));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pk");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sk");
  vi.stubEnv("MOCK_AI", "1");
});
afterEach(() => {
  setLogSink(null);
  lines.length = 0;
  vi.unstubAllEnvs();
  vi.useRealTimers();
  h.mode = "ok";
  h.calls = 0;
  h.adminTouched = 0;
  resetReadyCache();
});

describe("/api/health", () => {
  it("answers 200 with no dependency, even when the database client cannot be built", async () => {
    h.mode = "throw";
    const res = health(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.adminTouched).toBe(0);
  });
});

describe("/api/ready", () => {
  it("is 200 with only { ok, release } when configuration is complete and the database answers", async () => {
    const res = await ready(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["ok", "release"]);
    expect(body.ok).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is 503 when the call returns an error, throws, or hangs past 2 s, and the public body names nothing", async () => {
    for (const mode of ["error", "throw"] as const) {
      h.mode = mode;
      resetReadyCache();
      const res = await ready(req());
      expect(res.status).toBe(503);
      expect(Object.keys((await res.json()) as object).sort()).toEqual(["ok", "release"]);
    }
    h.mode = "hang";
    resetReadyCache();
    vi.useFakeTimers();
    const pending = ready(req());
    await vi.advanceTimersByTimeAsync(2100);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false });
    expect(lines.join("")).not.toContain("SECRETHOST");
  });

  it("lists the failed dependency names only for a caller with the right x-ready-token, and never when READY_TOKEN is unset", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    h.mode = "throw";
    const publicBody = await (await ready(req())).text();
    expect(publicBody).not.toMatch(/env|database|failed/);

    vi.stubEnv("READY_TOKEN", TOKEN);
    expect(await (await ready(req({ "x-ready-token": "wrong" }))).text()).not.toMatch(/failed/);
    expect(await (await ready(req())).text()).not.toMatch(/failed/);
    const withToken = await ready(req({ "x-ready-token": TOKEN }));
    expect(withToken.status).toBe(503);
    expect(await withToken.json()).toMatchObject({ ok: false, failed: ["env", "database"] });

    vi.stubEnv("READY_TOKEN", "");
    expect(await (await ready(req({ "x-ready-token": "" }))).text()).not.toMatch(/failed/);
    expect(publicBody + lines.join("")).not.toContain("SECRETHOST");
  });

  it("a token never changes a healthy answer", async () => {
    vi.stubEnv("READY_TOKEN", TOKEN);
    expect(Object.keys((await (await ready(req({ "x-ready-token": TOKEN }))).json()) as object).sort()).toEqual(["ok", "release"]);
  });

  it("logs every missing variable name readably, even when several are missing", async () => {
    for (const n of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) vi.stubEnv(n, "");
    await ready(req());
    expect(lines.join("")).toContain("next_public_supabase_url,next_public_supabase_publishable_key,supabase_secret_key");
  });

  it("answers a flood of callers with one database call, and checks again after 5 s", async () => {
    vi.useFakeTimers();
    const responses = await Promise.all(Array.from({ length: 100 }, () => ready(req())));
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(h.calls).toBe(1);
    await ready(req());
    expect(h.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(5100);
    await ready(req());
    expect(h.calls).toBe(2);
  });
});

describe("missingEnvNames mirrors env.ts", () => {
  it("with the mock on needs only Supabase (outside production)", () => {
    expect(missingEnvNames()).toEqual([]);
  });

  it("with the mock off needs the Groq key, both models and SESSION_SECRET", () => {
    vi.stubEnv("MOCK_AI", "0");
    expect(missingEnvNames().sort()).toEqual(["GROQ_API_KEY", "GROQ_MODEL_FAST", "GROQ_MODEL_QUALITY", "SESSION_SECRET"]);
    vi.stubEnv("GROQ_API_KEY", "k");
    vi.stubEnv("GROQ_MODEL_QUALITY", "q");
    expect(missingEnvNames().sort()).toEqual(["GROQ_MODEL_FAST", "SESSION_SECRET"]);
    vi.stubEnv("GROQ_MODEL_FAST", "f");
    vi.stubEnv("SESSION_SECRET", "s".repeat(32));
    expect(missingEnvNames()).toEqual([]);
  });

  it("in production even the mock needs SESSION_SECRET, and a too-short one counts as missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(missingEnvNames()).toEqual(["SESSION_SECRET"]);
    vi.stubEnv("SESSION_SECRET", "short");
    expect(missingEnvNames()).toEqual(["SESSION_SECRET"]);
    vi.stubEnv("SESSION_SECRET", "s".repeat(32));
    expect(missingEnvNames()).toEqual([]);
  });

  it("/api/ready is 503 when only a model name is missing", async () => {
    vi.stubEnv("MOCK_AI", "0");
    vi.stubEnv("GROQ_API_KEY", "k");
    vi.stubEnv("GROQ_MODEL_QUALITY", "q");
    vi.stubEnv("SESSION_SECRET", "s".repeat(32));
    expect((await ready(req())).status).toBe(503);
  });
});

describe("getRelease", () => {
  it("prefers the commit, then RELEASE, then the Vercel deployment id, then dev", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("RELEASE", "");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "");
    expect(getRelease()).toBe("dev");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_ABCDEFGHIJKLMN");
    expect(getRelease()).toBe("dpl_ABCDEFGH");
    vi.stubEnv("RELEASE", "2026-11-05.1");
    expect(getRelease()).toBe("2026-11-05.1");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef0123");
    expect(getRelease()).toBe("0123456789ab");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "bad value with spaces");
    expect(getRelease()).toBe("dev");
  });
});
