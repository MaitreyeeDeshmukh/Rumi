import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ mode: "ok" as "ok" | "error" | "hang" | "throw", calls: 0, adminTouched: 0 }));
vi.mock("@/lib/supabase/admin", () => ({
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
import { resetReadyCache } from "@/lib/telemetry/ready";

const lines: string[] = [];
const req = () => new Request("https://rumi.example/api/ready");

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
  it("is 200 when configuration is complete and the database answers", async () => {
    const res = await ready(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is 503 and names the database when the call returns an error, throws, or hangs past 2 s", async () => {
    for (const mode of ["error", "throw"] as const) {
      h.mode = mode;
      resetReadyCache();
      const res = await ready(req());
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, failed: ["database"] });
    }
    h.mode = "hang";
    resetReadyCache();
    vi.useFakeTimers();
    const pending = ready(req());
    await vi.advanceTimersByTimeAsync(2100);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, failed: ["database"] });
    expect(lines.join("")).not.toContain("SECRETHOST");
  });

  it("names the dependency, never the variable value or the error text", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    h.mode = "throw";
    const res = await ready(req());
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ ok: false, failed: ["env", "database"] });
    expect(text + lines.join("")).not.toContain("SECRETHOST");
    expect(lines.join("")).toContain("supabase_secret_key"); // the logs name the missing variable, not a value
  });

  it("logs every missing variable name readably, even when several are missing", async () => {
    for (const n of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) vi.stubEnv(n, "");
    await ready(req());
    expect(lines.join("")).toContain("next_public_supabase_url,next_public_supabase_publishable_key,supabase_secret_key");
  });

  it("needs the AI key only when the mock is off", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    expect((await ready(req())).status).toBe(200);
    vi.stubEnv("MOCK_AI", "0");
    resetReadyCache();
    expect(await (await ready(req())).json()).toEqual({ ok: false, failed: ["env"] });
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
