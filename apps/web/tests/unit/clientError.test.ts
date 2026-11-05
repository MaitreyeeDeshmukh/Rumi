import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRateLimiter } from "@/lib/security/rateLimit";

const h = vi.hoisted(() => ({ events: [] as Record<string, unknown>[] }));
vi.mock("@/lib/telemetry/sinks", () => ({ recordAppEvent: (e: Record<string, unknown>) => h.events.push(e) }));

import { setLogSink } from "@/lib/ai/telemetry";
import { CLIENT_ERROR_MAX_BYTES, MAX_FINGERPRINTS_PER_ROUTE, handleClientError, resetSeenFingerprints } from "@/lib/telemetry/clientError";
import { KNOWN_ROUTES } from "@/lib/telemetry/routes";

const lines: string[] = [];
setLogSink((l) => lines.push(l));
afterEach(() => {
  resetSeenFingerprints();
  h.events.length = 0;
  lines.length = 0;
});

const GOOD = { code: "render_error", route: "/help", fingerprint: "2349872346" };
const limiter = () => createRateLimiter({ limits: { perIp: 10, perSession: 10, perInstance: 120, perUnknownIp: 5 } });

function post(body: unknown, headers: Record<string, string> = {}, raw?: string): Request {
  return new Request("https://rumi.example/api/client-error", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", origin: "https://rumi.example", "content-type": "application/json", "x-real-ip": "203.0.113.7", ...headers },
    body: raw ?? JSON.stringify(body),
  });
}
const errorOf = async (res: Response): Promise<{ code: string; message: string; requestId: string }> => ((await res.json()) as { error: { code: string; message: string; requestId: string } }).error;

describe("POST /api/client-error", () => {
  it("accepts code, route and digest and records one client event", async () => {
    const res = await handleClientError(post(GOOD), limiter());
    expect(res.status).toBe(204);
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.events).toEqual([{ source: "client", area: "app", code: "render_error", fingerprint: "2349872346", route: "/help" }]);
  });

  it("accepts a report with no digest", async () => {
    expect((await handleClientError(post({ code: "global_error", route: "/" }), limiter())).status).toBe(204);
    expect(h.events[0]).toMatchObject({ code: "global_error", fingerprint: undefined });
  });

  it("stores a route that is not a known page as \"unknown\", so a script cannot invent route names", async () => {
    for (const route of ["https://evil.example/x", "/plan?text=SECRETTEXT", "/not-a-page", "/help/../admin", "/api/client-error", "", "<script>"]) {
      expect((await handleClientError(post({ ...GOOD, route }), limiter())).status).toBe(204);
    }
    expect(h.events.map((e) => e.route)).toEqual(Array(7).fill("unknown"));
    expect(JSON.stringify(h.events)).not.toContain("SECRETTEXT");
  });

  it("knows the query-less and trailing-slash forms of a real page", async () => {
    for (const route of ["/help?x=1", "/help/", "/privacy#top"]) await handleClientError(post({ ...GOOD, route }), limiter());
    expect(h.events.map((e) => e.route)).toEqual(["/help", "/help", "/privacy"]);
  });

  it("keeps at most 20 distinct digests per page; known ones and other pages are unaffected", async () => {
    const l = createRateLimiter({ limits: { perIp: 1000, perSession: 1000, perInstance: 1000, perUnknownIp: 1000 } });
    for (let i = 0; i < MAX_FINGERPRINTS_PER_ROUTE + 10; i++) await handleClientError(post({ ...GOOD, fingerprint: `digest${String(i).padStart(4, "0")}` }), l);
    const stored = h.events.map((e) => e.fingerprint);
    expect(stored.filter((f) => f !== undefined)).toHaveLength(MAX_FINGERPRINTS_PER_ROUTE);
    expect(stored.filter((f) => f === undefined)).toHaveLength(10);
    h.events.length = 0;
    await handleClientError(post({ ...GOOD, fingerprint: "digest0003" }), l); // already known
    await handleClientError(post({ ...GOOD, route: "/privacy", fingerprint: "digest9999" }), l); // another page
    expect(h.events.map((e) => e.fingerprint)).toEqual(["digest0003", "digest9999"]);
  });

  it("lists every static page of the app, so a new page cannot report as unknown by mistake", () => {
    const root = fileURLToPath(new URL("../../src/app", import.meta.url));
    const pages: string[] = [];
    const walk = (dir: string, route: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name === "api" || entry.name.startsWith("[") || entry.name.startsWith("_") || entry.name.startsWith("@")) continue;
          const group = entry.name.startsWith("(") && entry.name.endsWith(")");
          walk(join(dir, entry.name), group ? route : `${route === "/" ? "" : route}/${entry.name}`);
        } else if (/^page.(tsx|ts|jsx|js|mdx)$/.test(entry.name)) pages.push(route);
      }
    };
    walk(root, "/");
    expect(pages.length).toBeGreaterThan(3);
    for (const p of pages) expect(KNOWN_ROUTES, `add ${p} to KNOWN_ROUTES in src/lib/telemetry/routes.ts`).toContain(p);
  });

  it("refuses other sites and requests that are not browser fetches", async () => {
    expect((await handleClientError(post(GOOD, { "sec-fetch-site": "cross-site" }), limiter())).status).toBe(403);
    expect((await handleClientError(post(GOOD, { origin: "https://evil.example" }), limiter())).status).toBe(403);
    const bare = new Request("https://rumi.example/api/client-error", { method: "POST", body: JSON.stringify(GOOD) });
    expect((await handleClientError(bare, limiter())).status).toBe(403);
    expect(h.events).toEqual([]);
  });

  it("refuses a body over 2 KB, declared or streamed without a length", async () => {
    const big = { ...GOOD, fingerprint: "a".repeat(CLIENT_ERROR_MAX_BYTES + 10) };
    expect((await handleClientError(post(big, { "content-length": String(JSON.stringify(big).length) }), limiter())).status).toBe(413);
    const streamed = new Request("https://rumi.example/api/client-error", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", "x-real-ip": "203.0.113.7" },
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("x".repeat(CLIENT_ERROR_MAX_BYTES + 1)));
          c.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect((await handleClientError(streamed, limiter())).status).toBe(413);
    expect(h.events).toEqual([]);
  });

  it("refuses anything beyond code, route and digest: message, stack, user text, unknown codes, bad routes, bad JSON", async () => {
    const bads: unknown[] = [
      { ...GOOD, message: "my knee hurts SECRETTEXT" },
      { ...GOOD, stack: "at x" },
      { ...GOOD, code: "SECRETTEXT" },
      { ...GOOD, route: "x".repeat(121) },
      { ...GOOD, fingerprint: "ABCDEFGH12" },
      { ...GOOD, fingerprint: "short" },
      { ...GOOD, fingerprint: "a".repeat(65) },
      { ...GOOD, fingerprint: "has spaces SECRETTEXT" },
      { code: "render_error" },
      [],
      "string",
      null,
    ];
    for (const b of bads) {
      const res = await handleClientError(post(b), limiter());
      expect(res.status).toBe(400);
      expect(JSON.stringify(await errorOf(res))).not.toContain("SECRETTEXT");
    }
    expect((await handleClientError(post(null, {}, "{not json SECRETTEXT"), limiter())).status).toBe(400);
    expect(h.events).toEqual([]);
    expect(lines.join("")).not.toContain("SECRETTEXT");
  });

  it("limits a flood from one address to 10 a minute, with Retry-After, and lets other addresses through", async () => {
    const l = limiter();
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) statuses.push((await handleClientError(post(GOOD), l)).status);
    expect(statuses.filter((s) => s === 204)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    const limited = await handleClientError(post(GOOD), l);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(h.events).toHaveLength(10); // refused calls write nothing
    expect((await handleClientError(post(GOOD, { "x-real-ip": "198.51.100.9" }), l)).status).toBe(204);
  });

  it("limits many different addresses with the per-instance cap", async () => {
    const l = createRateLimiter({ limits: { perIp: 10, perSession: 10, perInstance: 120, perUnknownIp: 5 } });
    let ok = 0;
    for (let i = 0; i < 200; i++) {
      const res = await handleClientError(post(GOOD, { "x-real-ip": `10.0.${Math.floor(i / 250)}.${i % 250}` }), l);
      if (res.status === 204) ok++;
    }
    expect(ok).toBe(120);
  });

  it("limits requests with no readable address harder (5 a minute)", async () => {
    const l = limiter();
    let ok = 0;
    for (let i = 0; i < 9; i++) {
      const req = new Request("https://rumi.example/api/client-error", { method: "POST", headers: { "sec-fetch-site": "same-origin" }, body: JSON.stringify(GOOD) });
      if ((await handleClientError(req, l)).status === 204) ok++;
    }
    expect(ok).toBe(5);
  });
});
