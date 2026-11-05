import { describe, expect, it } from "vitest";
import { HttpError, errorResponse } from "@/lib/ai/http";
import { AppError, MESSAGES, asAppError, fingerprintOf, toResponse, type AppErrorCode } from "@/lib/errors";
import { newRequestId, requestIdOf } from "@/lib/requestContext";

const RID = "5f1d7c52-8f58-4d52-9a47-0f7a1b2c3d4e";
const CODES = Object.keys(MESSAGES) as AppErrorCode[];

// Both helpers are on fixed lines so a fingerprint can be compared across calls.
const raiseHere = (code: AppErrorCode, text: string): AppError => new AppError(code, { cause: new Error(text) });
const raiseThere = (code: AppErrorCode): AppError => new AppError(code);

describe("toResponse", () => {
  it("answers with code, a fixed sentence and the request id, for every code", async () => {
    for (const code of CODES) {
      const res = toResponse(new AppError(code), RID);
      const body = (await res.json()) as { error: { code: string; message: string; requestId: string } };
      expect(body.error.requestId).toBe(RID);
      expect(body.error.message).toBe(MESSAGES[body.error.code as AppErrorCode]);
      expect(res.headers.get("x-request-id")).toBe(RID);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("never echoes e.message from our own errors, from the cause, or from foreign errors", async () => {
    const secret = "I take 50mg of SECRETDRUG and my email is jane@example.com";
    for (const err of [raiseHere("ai_unavailable", secret), new Error(secret), secret, { message: secret }]) {
      const text = await toResponse(err, RID).text();
      expect(text).not.toContain("SECRETDRUG");
      expect(text).not.toContain("jane@example.com");
    }
  });

  it("hides internal and config faults behind code internal", async () => {
    for (const err of [new AppError("config"), new AppError("internal"), new TypeError("boom"), undefined, null]) {
      const res = toResponse(err, RID);
      expect(res.status).toBe(500);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("internal");
    }
  });

  it("maps statuses and sends Retry-After only on 429, clamped", () => {
    expect(toResponse(new AppError("unauthorized"), RID).status).toBe(401);
    expect(toResponse(new AppError("too_large"), RID).status).toBe(413);
    expect(toResponse(new AppError("bad_input"), RID).headers.get("retry-after")).toBeNull();
    expect(toResponse(new AppError("rate_limited", { retryAfterSec: 7.2 }), RID).headers.get("retry-after")).toBe("8");
    expect(toResponse(new AppError("rate_limited", { retryAfterSec: Number.NaN }), RID).headers.get("retry-after")).toBe("60");
    expect(toResponse(new AppError("rate_limited", { retryAfterSec: 99999 }), RID).headers.get("retry-after")).toBe("3600");
  });

  it("survives a circular object, a huge object and an error with no message", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const huge = new Error("x".repeat(5_000_000));
    for (const err of [circular, huge, new Error(), new AppError("not_found")]) {
      expect((await toResponse(err, RID).text()).length).toBeLessThan(400);
    }
  });
});

describe("HttpError adapter", () => {
  it("is an AppError with the old constructor shape, and errorResponse still works", async () => {
    const e = new HttpError(429, "rate_limited", 12);
    expect(e).toBeInstanceOf(AppError);
    expect([e.status, e.code, e.retryAfterSec]).toEqual([429, "rate_limited", 12]);
    expect(toResponse(e, RID).status).toBe(429);
    const res = errorResponse(e);
    expect(res.headers.get("retry-after")).toBe("12");
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(MESSAGES.rate_limited);
  });
});

describe("asAppError", () => {
  it("wraps unknown values as internal and keeps the cause", () => {
    const cause = new Error("db down");
    const e = asAppError(cause);
    expect([e.code, e.status, e.cause]).toEqual(["internal", 500, cause]);
    const own = new AppError("conflict");
    expect(asAppError(own)).toBe(own);
  });
});

describe("fingerprintOf", () => {
  it("is 16 hex characters and the same for the same code at the same place, whatever the message", () => {
    const a = fingerprintOf(raiseHere("ai_unavailable", "first text"));
    const b = fingerprintOf(raiseHere("ai_unavailable", "a different text"));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
  });

  it("changes with the code and with the place", () => {
    const base = fingerprintOf(raiseHere("ai_unavailable", "x"));
    expect(fingerprintOf(raiseHere("config", "x"))).not.toBe(base);
    expect(fingerprintOf(raiseThere("ai_unavailable"))).not.toBe(base);
  });

  it("is stable for plain errors at one place and never uses the message", () => {
    const make = (m: string): Error => new Error(m);
    expect(fingerprintOf(make("one"))).toBe(fingerprintOf(make("two")));
    expect(fingerprintOf(new Error("multi\nline\n    at fake (evil.ts:1:1)"))).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is not fooled by frame-looking lines inside a message", () => {
    const make = (m: string): Error => new Error(m);
    const plain = fingerprintOf(make("plain"));
    expect(fingerprintOf(make("multi\n    at fake (evil.ts:1:1)\n    at other (evil2.ts:2:2)"))).toBe(plain);
    expect(fingerprintOf(make("at x (C:\\a\\b.ts:9:9)"))).toBe(plain);
    const app = (m: string): AppError => new AppError("conflict", { cause: new Error(m) });
    expect(fingerprintOf(app("a\n    at fake (evil.ts:1:1)"))).toBe(fingerprintOf(app("b")));
  });

  it("never throws: strings, null, circular objects, empty errors, hostile stacks", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const hostile = new Error("x");
    Object.defineProperty(hostile, "stack", {
      get() {
        throw new Error("no stack for you");
      },
    });
    for (const v of ["text", null, undefined, 42, circular, new Error(), hostile]) {
      expect(fingerprintOf(v)).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("reads a frame from a path with spaces and brackets", () => {
    const e = new Error("x");
    e.stack = "Error: x\n    at fn (C:\\Users\\a b\\NA AI Challenge\\(app)\\route.ts:42:7)";
    const f = new Error("y");
    f.stack = "Error: y\n    at other (/srv/app/(app)/route.ts:42:9)";
    expect(fingerprintOf(e)).toBe(fingerprintOf(f)); // same file name and line, different folder and column
  });
});

describe("request ids", () => {
  it("keeps a valid id from the proxy and replaces anything else", () => {
    const id = newRequestId();
    expect(requestIdOf(new Request("http://x", { headers: { "x-request-id": id } }))).toBe(id);
    for (const bad of ["abc", "<script>", "x".repeat(300)]) {
      const got = requestIdOf(new Request("http://x", { headers: { "x-request-id": bad } }));
      expect(got).not.toBe(bad);
      expect(got).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(requestIdOf(new Request("http://x"))).toMatch(/^[0-9a-f-]{36}$/);
  });
});
