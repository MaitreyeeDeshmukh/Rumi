import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as plan } from "@/app/api/plan/route";
import { POST as practice } from "@/app/api/practice/route";
import { POST as sayit } from "@/app/api/sayit/route";
import { POST as recap } from "@/app/api/recap/route";
import { POST as consent } from "@/app/api/memory/consent/route";
import { POST as facts } from "@/app/api/memory/facts/route";
import { POST as forget } from "@/app/api/memory/forget/route";
import { POST as accountDelete } from "@/app/api/account/delete/route";
import { GET as accountExport } from "@/app/api/account/export/route";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const API = fileURLToPath(new URL("../../src/app/api/", import.meta.url));

beforeEach(() => {
  vi.stubEnv("VERCEL", "1");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const crossSite = (path: string, method = "POST"): Request =>
  new Request(`https://rumi.example${path}`, { method, headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example", "content-type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) });

describe("every product route runs the guard first and echoes the request id", () => {
  const routes: Array<[string, (req: Request) => Promise<Response>, string?]> = [
    ["/api/plan", plan],
    ["/api/practice", practice],
    ["/api/sayit", sayit],
    ["/api/recap", recap],
    ["/api/memory/consent", consent],
    ["/api/memory/facts", facts],
    ["/api/memory/forget", forget],
    ["/api/account/delete", accountDelete],
    ["/api/account/export", accountExport, "GET"],
  ];

  it.each(routes)("%s refuses a cross-site request with 403, a fixed body and the request id (the guard is awaited)", async (path, handler, method) => {
    const sent = "11111111-2222-4333-8444-555555555555";
    const req = crossSite(path, method);
    req.headers.set("x-request-id", sent);
    const res = await handler(req);
    expect(res.status).toBe(403);
    expect(res.headers.get("x-request-id")).toBe(sent);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("forbidden");
    expect(body.error.requestId).toMatch(UUID);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it.each(routes)("%s makes a fresh request id when the sent one is not a uuid", async (path, handler, method) => {
    const req = crossSite(path, method);
    req.headers.set("x-request-id", "<script>alert(1)</script>");
    expect(((await handler(req)).headers.get("x-request-id") ?? "")).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe("source rules for route handlers", () => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir)) (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f === "route.ts" && files.push(join(dir, f)));
  };
  walk(API);
  const rel = (f: string): string => f.slice(API.length).replaceAll("\\", "/");

  it("finds all the routes", () => {
    expect(files.map(rel).sort()).toEqual(
      ["account/delete/route.ts", "account/export/route.ts", "client-error/route.ts", "health/route.ts", "memory/consent/route.ts", "memory/facts/route.ts", "memory/forget/route.ts", "plan/route.ts", "practice/route.ts", "ready/route.ts", "recap/route.ts", "sayit/route.ts"].sort(),
    );
  });

  it("no route reads the retired cookie, key header, recovery code or the old memory service", () => {
    // Built from parts so this file is not itself a hit for the repository-wide "old memory service is gone" scan.
    const retired = new RegExp(["rumi_sid", "x-rumi-key", ["super", "memory"].join(""), ["recovery", "Code"].join("")].join("|"), "i");
    for (const f of files) expect(readFileSync(f, "utf8")).not.toMatch(retired);
  });

  it("routes that do their own work call guardRequest, createLogger and toResponse; the rest delegate to a handler that does", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (/account\//.test(rel(f))) {
        expect(text, rel(f)).toMatch(/guardRequest\(/);
        expect(text, rel(f)).toMatch(/createLogger\(/);
        expect(text, rel(f)).toMatch(/toResponse\(/);
      } else if (/(plan|practice|sayit|recap)\//.test(rel(f))) {
        expect(text, rel(f)).toMatch(/runTask\(/);
      } else if (/memory\//.test(rel(f))) {
        expect(text, rel(f)).toMatch(/routeDeps/);
      }
    }
  });
});
