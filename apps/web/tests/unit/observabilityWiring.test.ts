import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const h = vi.hoisted(() => ({ events: [] as Record<string, unknown>[] }));
vi.mock("@/lib/telemetry/sinks", () => ({ recordAppEvent: (e: Record<string, unknown>) => h.events.push(e) }));

import { setLogSink } from "@/lib/ai/telemetry";
import { resetThrottle } from "@/lib/telemetry/throttle";
import { AppError } from "@/lib/errors";
import { reportClientError } from "@/lib/telemetry/reportClientError";
import { sentryBeforeSend } from "@/lib/telemetry/sentry";
import { reportServerFault } from "@/lib/telemetry/serverFault";
import { respondWithError } from "@/lib/telemetry/respond";

const src = (p: string): string => readFileSync(fileURLToPath(new URL(`../../src/${p}`, import.meta.url)), "utf8");
const RID = "5f1d7c52-8f58-4d52-9a47-0f7a1b2c3d4e";
const lines: string[] = [];
setLogSink((l) => lines.push(l));
afterEach(() => {
  resetThrottle();
  h.events.length = 0;
  lines.length = 0;
  vi.unstubAllGlobals();
});

describe("wiring: the pieces are connected, not just written", () => {
  it("both error boundaries report the digest through reportClientError", () => {
    for (const f of ["app/error.tsx", "app/global-error.tsx"]) {
      const text = src(f);
      expect(text, f).toContain("reportClientError(");
      expect(text, f).toContain("error.digest");
      expect(text, f).not.toMatch(/error\.(message|stack)/);
    }
  });

  it("instrumentation exports onRequestError and routes it to serverFault", () => {
    const text = src("instrumentation.ts");
    expect(text).toContain("export const onRequestError");
    expect(text).toContain("telemetry/serverFault");
  });

  it("observability code never reads an error message, except our own timeout marker", () => {
    for (const f of ["lib/log.ts", "lib/errors.ts", "lib/telemetry/sinks.ts", "lib/telemetry/ready.ts", "lib/telemetry/respond.ts", "lib/telemetry/serverFault.ts", "lib/telemetry/clientError.ts", "lib/telemetry/sentry.ts"]) {
      const code = src(f).split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
      for (const line of code.filter((l) => /\.message\b/.test(l))) expect(`${f}: ${line}`).toMatch(/message === "timeout"|delete e.message|err.message/);
    }
  });

  it("the three routes exist and use the shared helpers", () => {
    expect(src("app/api/client-error/route.ts")).toContain("handleClientError");
    expect(src("app/api/ready/route.ts")).toContain("checkReady");
    expect(src("app/api/health/route.ts")).toContain("export function GET");
  });
});

describe("respondWithError", () => {
  it("5xx: one ERROR line with a fingerprint, one app event, a sanitized body", async () => {
    const res = respondWithError(new AppError("ai_unavailable", { cause: new Error("PRIVATETEXT") }), { requestId: RID, route: "/api/plan" });
    expect(res.status).toBe(503);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ level: "error", code: "ai_unavailable", status: 503 });
    expect(h.events).toEqual([expect.objectContaining({ source: "server", area: "ai", code: "ai_unavailable", route: "/api/plan", status: 503 })]);
    expect(lines.join("") + (await res.text())).not.toContain("PRIVATETEXT");
  });

  it("4xx lines are sampled: one a minute per route and code, then the count of skipped ones", () => {
    for (let i = 0; i < 25; i++) respondWithError(new AppError("rate_limited"), { requestId: RID, route: "/api/client-error" });
    expect(lines).toHaveLength(1);
    respondWithError(new AppError("bad_input"), { requestId: RID, route: "/api/client-error" }); // another code: its own line
    respondWithError(new AppError("rate_limited"), { requestId: RID, route: "/api/plan" }); // another route: its own line
    expect(lines).toHaveLength(3);
    vi.useFakeTimers({ now: Date.now() + 61_000 });
    respondWithError(new AppError("rate_limited"), { requestId: RID, route: "/api/client-error" });
    vi.useRealTimers();
    expect(JSON.parse(lines[3]).repeats).toBe(24);
  });

  it("4xx: a warning, no app event", () => {
    const res = respondWithError(new AppError("bad_input"), { requestId: RID, route: "/api/plan" });
    expect(res.status).toBe(400);
    expect(JSON.parse(lines[0]).level).toBe("warn");
    expect(h.events).toEqual([]);
  });

  it("a thrown string or null becomes a 500 internal", async () => {
    for (const v of ["oops PRIVATETEXT", null]) {
      const res = respondWithError(v, { requestId: RID, route: "/api/plan" });
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("PRIVATETEXT");
    }
    expect(h.events).toHaveLength(2);
  });
});

describe("reportServerFault (onRequestError)", () => {
  it("logs once with the digest and the request id from the proxy, and records an app event", () => {
    const err = Object.assign(new Error("PRIVATETEXT"), { digest: "98765" });
    reportServerFault(err, "/app/plan/[id]/page", { "x-request-id": RID });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ level: "error", event: "unhandled_error", requestId: RID, route: "/app/plan/[id]/page", digest: "98765", code: "internal" });
    expect(lines[0]).not.toContain("PRIVATETEXT");
    expect(h.events).toEqual([expect.objectContaining({ source: "server", code: "unhandled", route: "/app/plan/[id]/page", status: 500 })]);
  });

  it("logs a digest only when it is a plain number; a crafted one is dropped", () => {
    for (const digest of ["<script>alert(1)</script>", "abc", "1".repeat(40), "12 34 56", ""]) {
      lines.length = 0;
      reportServerFault(Object.assign(new Error("x"), { digest }), "/x");
      expect(lines[0]).not.toContain("digest");
      expect(lines[0]).not.toContain("script");
    }
  });

  it("ignores a forged request id and does not record caller faults", () => {
    reportServerFault(new AppError("bad_input"), "/x", { "x-request-id": "<script>" });
    expect(JSON.parse(lines[0]).requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.events).toEqual([]);
  });
});

describe("reportClientError (browser)", () => {
  it("posts only code, route and a valid digest", () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("window", { location: { pathname: "/plan" } });
    vi.stubGlobal("fetch", fetchMock);
    reportClientError("render_error", "2349872346");
    reportClientError("global_error", "bad digest with spaces");
    reportClientError("global_error", "UPPER12345");
    const calls = fetchMock.mock.calls as unknown as [string, { body: string; method: string }][];
    expect(calls[0][0]).toBe("/api/client-error");
    expect(JSON.parse(calls[0][1].body)).toEqual({ code: "render_error", route: "/plan", fingerprint: "2349872346" });
    expect(JSON.parse(calls[1][1].body)).toEqual({ code: "global_error", route: "/plan" });
  });

  it("never throws or leaves an unhandled rejection when the network, fetch or window is broken", async () => {
    vi.stubGlobal("window", { location: { pathname: "/plan" } });
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    expect(() => reportClientError("render_error")).not.toThrow();
    vi.stubGlobal("fetch", () => {
      throw new Error("blocked");
    });
    expect(() => reportClientError("render_error")).not.toThrow();
    vi.unstubAllGlobals();
    expect(() => reportClientError("render_error")).not.toThrow(); // no window at all
    await new Promise((r) => setTimeout(r, 5));
  });
});

describe("sentryBeforeSend", () => {
  it("drops request, user, breadcrumbs, extra, contexts and every exception message", () => {
    const event = {
      event_id: "1",
      message: "user text",
      request: { data: "body", cookies: "rumi", headers: { cookie: "x" }, query_string: "token=1" },
      user: { id: "u", email: "a@b.co", ip_address: "1.2.3.4" },
      breadcrumbs: [{ message: "clicked" }],
      extra: { text: "t" },
      contexts: { device: {} },
      exception: { values: [{ type: "Error", value: "my knee hurts", stacktrace: { frames: [{ vars: { text: "x" } }] } }] },
      tags: { route: "/plan" },
    };
    const out = JSON.stringify(sentryBeforeSend(event));
    for (const leak of ["user text", "body", "rumi", "token=1", "a@b.co", "1.2.3.4", "clicked", "my knee hurts", "vars"]) expect(out).not.toContain(leak);
    expect(out).toContain("/plan");
  });

  it("drops events that are not objects", () => {
    expect(sentryBeforeSend(null)).toBeNull();
    expect(sentryBeforeSend("x")).toBeNull();
  });
});
