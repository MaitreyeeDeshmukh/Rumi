import { describe, expect, it } from "vitest";
import { REPO_ROOT, runNode, serve, type FakeReply, type Handler } from "./run";

const SCRIPT = `${REPO_ROOT}scripts/smoke.mjs`;

const SECURITY = {
  "strict-transport-security": "max-age=63072000",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=()",
  "cross-origin-opener-policy": "same-origin",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
};
const API = { "cache-control": "no-store", "x-request-id": "0b9e2f5c-1111-4222-8333-444455556666", "content-type": "application/json" };

type Overrides = Partial<Record<"health" | "ready" | "task" | "home" | "taskError", FakeReply>>;

/** A healthy site; `over` replaces one answer. */
function site(over: Overrides = {}): Handler {
  return (req) => {
    const url = req.url ?? "";
    if (url === "/api/health") return over.health ?? { headers: API, body: { ok: true, release: "abc123" } };
    if (url === "/api/ready") return over.ready ?? { headers: API, body: { ok: true } };
    if (url === "/api/sayit") {
      return req.headers["content-length"] === "2"
        ? (over.taskError ?? { status: 400, headers: API, body: { error: { code: "bad_input" } } })
        : (over.task ?? { headers: API, body: { script: "I would like to book a visit.", blanks: [] } });
    }
    return over.home ?? { headers: SECURITY, body: "<html></html>" };
  };
}

async function smoke(over: Overrides = {}): Promise<{ code: number | null; out: string }> {
  const s = await serve(site(over));
  try {
    const r = await runNode(SCRIPT, [s.url]);
    return { code: r.code, out: r.stdout };
  } finally {
    await s.close();
  }
}

describe("scripts/smoke.mjs", () => {
  it("passes every check against a healthy site and exits 0", async () => {
    const { code, out } = await smoke();
    expect(out).not.toMatch(/^FAIL/m);
    expect(out.match(/^PASS/gm)?.length).toBe(8);
    expect(code).toBe(0);
  });

  it("refuses to run without a base URL", async () => {
    const r = await runNode(SCRIPT, []);
    expect(r.code).toBe(2);
  });

  it("FAILs when /api/health is down", async () => {
    const { code, out } = await smoke({ health: { status: 500, headers: API, body: {} } });
    expect(out).toMatch(/^FAIL GET \/api\/health/m);
    expect(code).toBe(1);
  });

  it("FAILs when /api/health says 200 but not {ok:true}, or has no release", async () => {
    for (const body of [{ ok: false, release: "r" }, { ok: true }, { release: "r" }]) {
      const { code, out } = await smoke({ health: { headers: API, body } });
      expect(out, JSON.stringify(body)).toMatch(/^FAIL GET \/api\/health/m);
      expect(code).toBe(1);
    }
  });

  it("FAILs when /api/ready is 503 and names the failing dependency", async () => {
    const { code, out } = await smoke({ ready: { status: 503, headers: API, body: { ok: false, failed: ["supabase"] } } });
    expect(out).toMatch(/^FAIL GET \/api\/ready.*supabase/m);
    expect(code).toBe(1);
  });

  it("FAILs when the mocked task answers with an error, with no script, or degraded", async () => {
    for (const task of [
      { status: 429, headers: API, body: { error: { code: "rate_limited" } } },
      { headers: API, body: { blanks: [] } },
      { headers: API, body: { script: "x", blanks: [], degraded: true } },
    ]) {
      const { code, out } = await smoke({ task });
      expect(out).toMatch(/^FAIL one mocked task/m);
      expect(code).toBe(1);
    }
  });

  it("FAILs when an API answer can be cached", async () => {
    const { code, out } = await smoke({ health: { headers: { ...API, "cache-control": "public, max-age=60" }, body: { ok: true, release: "r" } } });
    expect(out).toMatch(/^FAIL \/api\/health sends Cache-Control/m);
    expect(code).toBe(1);
  });

  it("FAILs when an error answer has no no-store (errors must not be cached either)", async () => {
    const { code, out } = await smoke({ taskError: { status: 400, headers: { "x-request-id": API["x-request-id"] }, body: {} } });
    expect(out).toMatch(/^FAIL \/api\/sayit sends Cache-Control/m);
    expect(code).toBe(1);
  });

  it("FAILs when x-request-id is missing", async () => {
    const { "x-request-id": _drop, ...noId } = API;
    void _drop;
    const { code, out } = await smoke({ ready: { headers: noId, body: { ok: true } } });
    expect(out).toMatch(/^FAIL \/api\/ready sends Cache-Control.*x-request-id/m);
    expect(code).toBe(1);
  });

  it("FAILs for each missing security header and for x-powered-by", async () => {
    await Promise.all(
      Object.keys(SECURITY).map(async (header) => {
        const headers: Record<string, string> = { ...SECURITY };
        delete headers[header];
        const { code, out } = await smoke({ home: { headers, body: "<html></html>" } });
        expect(out, header).toMatch(new RegExp(`^FAIL home page sends every security header.*${header}`, "m"));
        expect(code).toBe(1);
      }),
    );
    const { out } = await smoke({ home: { headers: { ...SECURITY, "x-powered-by": "Next.js" }, body: "" } });
    expect(out).toMatch(/^FAIL home page.*x-powered-by/m);
  });

  it("FAILs on a wildcard CSP source or a framable page", async () => {
    await Promise.all(
      ["default-src *; frame-ancestors 'none'", "default-src 'self'", "script-src https://x.test *; frame-ancestors 'none'"].map(async (csp) => {
        const { code, out } = await smoke({ home: { headers: { ...SECURITY, "content-security-policy": csp }, body: "" } });
        expect(out, csp).toMatch(/^FAIL CSP/m);
        expect(code).toBe(1);
      }),
    );
  });

  it("FAILs (exit 1, not a crash) when nothing is listening", async () => {
    const gone = await serve(() => ({}));
    await gone.close(); // a port that was just in use refuses at once
    const r = await runNode(SCRIPT, [gone.url]);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^FAIL .*request failed/m);
    expect(r.stdout).not.toMatch(/^PASS/m);
  });
});
