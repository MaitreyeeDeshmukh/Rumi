import { afterEach, describe, expect, it, vi } from "vitest";
import { setLogSink } from "@/lib/ai/telemetry";
import { HttpError } from "@/lib/ai/http";
import { AppError } from "@/lib/errors";
import { createLogger, redactFields } from "@/lib/log";
import { setErrorReporter, type ErrorReport } from "@/lib/telemetry/sentry";

const RID = "5f1d7c52-8f58-4d52-9a47-0f7a1b2c3d4e";
const lines: string[] = [];
const levels: (string | undefined)[] = [];
setLogSink((l, level) => {
  lines.push(l);
  levels.push(level);
});
const out = (): Record<string, unknown>[] => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
const log = () => createLogger({ requestId: RID, route: "/api/plan" });

afterEach(() => {
  lines.length = 0;
  levels.length = 0;
  setErrorReporter(null);
  vi.unstubAllEnvs();
});

describe("logger redaction", () => {
  it("writes one JSON line with ts, level, event, requestId, route, release", () => {
    log().info("plan_done", { count: 3, ok: true });
    expect(lines).toHaveLength(1);
    const o = out()[0];
    expect(Object.keys(o).sort()).toEqual(["count", "event", "level", "ok", "release", "requestId", "route", "ts"]);
    expect([o.level, o.event, o.requestId, o.route, o.count, o.ok]).toEqual(["info", "plan_done", RID, "/api/plan", 3, true]);
    expect(new Date(String(o.ts)).toISOString()).toBe(o.ts);
  });

  it("drops fields whose key names text, secrets or identities", () => {
    log().info("x", {
      text: "my knee hurts",
      body: "b",
      content: "c",
      prompt: "p",
      message: "m",
      email: "a@b.co",
      accessToken: "t",
      apiKey: "k",
      secret: "s",
      password: "pw",
      authorization: "Bearer abc",
      cookie: "rumi_sid=1",
      userId: "u1",
      keep: "fine",
    });
    expect(Object.keys(out()[0]).filter((k) => !["ts", "level", "event", "requestId", "route", "release"].includes(k))).toEqual(["keep"]);
  });

  it("replaces emails and tokens that hide under an innocent key, and hashes long strings", () => {
    const longText = "I have been feeling pain in my left knee for three weeks and I do not know what to tell the doctor. ".repeat(5);
    log().info("x", {
      note: "write to jane.doe@example.com please",
      detail: "sk-live1234567890abcdef",
      jwt: "eyJhbGciOiJIUzI1NiJ9.payload.sig",
      bearer: "Bearer abc.def",
      userRef: "a1b2c3d4-1111-4222-8333-444455556666",
      blob: "AbCdEfGhIjKlMnOpQrStUvWxYz0123",
      long: longText,
    });
    const line = lines[0];
    for (const leak of ["jane.doe", "example.com", "sk-live", "eyJhbGci", "abc.def", "a1b2c3d4-1111", "AbCdEfGh", "feeling pain", "left knee"]) {
      expect(line, leak).not.toContain(leak);
    }
    const o = out()[0];
    expect(o.note).toBe("[redacted]");
    expect(String(o.long)).toMatch(/^h:[0-9a-f]{12}$/);
    log().info("x", { long: longText });
    expect(out()[1].long).toBe(o.long); // stable marker: the same text always hashes the same
  });

  it("lets plain short codes through, including snake_case words", () => {
    log().info("x", { reason: "store_unavailable_after_retry", area: "ai" });
    const o = out()[0];
    expect([o.reason, o.area]).toEqual(["store_unavailable_after_retry", "ai"]);
  });

  it("cannot be spoofed: fields never overwrite ts, level, event, requestId, route or release", () => {
    log().info("real_event", { level: "debug", ts: "yesterday", requestId: "evil", route: "/evil", release: "evil", event: "evil" } as never);
    const o = out()[0];
    expect([o.level, o.event, o.requestId, o.route]).toEqual(["info", "real_event", RID, "/api/plan"]);
    expect(o.ts).not.toBe("yesterday");
    expect(o.release).not.toBe("evil");
  });

  it("cleans a bad request id, a bad route and a bad event name", () => {
    createLogger({ requestId: "not-a-uuid <script>", route: "/api/plan?token=abc&text=hello there" }).info("Bad Event!", {});
    const o = out()[0];
    expect([o.requestId, o.route, o.event]).toEqual(["invalid", "/api/plan", "invalid_event"]);
  });

  it("never throws on odd fields: NaN, undefined, nested objects, thousands of keys", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 5000; i++) many[`k${i}`] = "v";
    expect(() => {
      log().info("x", { a: Number.NaN, b: undefined, c: { nested: "x" } as never, ...many });
      redactFields(null as never);
    }).not.toThrow();
    expect(Object.keys(out()[0]).length).toBeLessThan(45);
  });
});

describe("logger failure", () => {
  it("never throws into a request when the log sink itself fails", () => {
    setLogSink(() => {
      throw new Error("stdout closed");
    });
    expect(() => {
      log().info("x", { a: 1 });
      log().warn("x");
      log().error("x", new AppError("internal"));
    }).not.toThrow();
    setLogSink((l, level) => {
      lines.push(l);
      levels.push(level);
    });
  });
});

describe("logger.error", () => {
  it("logs code, fingerprint and status for a system fault, once, at error level, and never the message", () => {
    const secret = "user said: I take 50mg of SECRETDRUG";
    log().error("request_failed", new AppError("ai_unavailable", { cause: new Error(secret) }), { task: "plan" });
    expect(lines).toHaveLength(1);
    expect(levels).toEqual(["error"]);
    expect(lines[0]).not.toContain("SECRETDRUG");
    const o = out()[0];
    expect([o.level, o.code, o.status, o.task]).toEqual(["error", "ai_unavailable", 503, "plan"]);
    expect(o.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("logs a foreign error as code internal without its message, stack or name", () => {
    log().error("request_failed", new TypeError("cannot read property 'x' of the secret SECRETDRUG"));
    expect(lines[0]).not.toContain("SECRETDRUG");
    expect(lines[0]).not.toContain("TypeError");
    expect(out()[0]).toMatchObject({ level: "error", code: "internal", status: 500 });
  });

  it("logs caller faults (4xx) as warnings, never ERROR, and never reaches the error reporter", () => {
    vi.stubEnv("SENTRY_DSN", "https://example.invalid/1");
    const seen: ErrorReport[] = [];
    setErrorReporter({ capture: (r) => seen.push(r) });
    for (const e of [new HttpError(400, "bad_input"), new AppError("unauthorized"), new HttpError(429, "rate_limited", 5)]) log().error("request_rejected", e);
    expect(levels).toEqual(["warn", "warn", "warn"]);
    expect(out().map((o) => o.level)).toEqual(["warn", "warn", "warn"]);
    expect(seen).toEqual([]);
  });

  it("survives a string, null, a circular object, an error with no message and a huge error", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const v of ["just a string with private text", null, undefined, circular, new Error(), new Error("y".repeat(3_000_000))]) {
      expect(() => log().error("request_failed", v)).not.toThrow();
    }
    expect(lines).toHaveLength(6);
    expect(lines.join("")).not.toContain("private text");
    expect(lines.every((l) => l.length < 400)).toBe(true);
  });

  it("sends a scrubbed report to the reporter for 5xx only when SENTRY_DSN is set", () => {
    const seen: ErrorReport[] = [];
    setErrorReporter({ capture: (r) => seen.push(r) });
    log().error("request_failed", new AppError("store_unavailable"));
    expect(seen).toEqual([]); // no DSN: nothing leaves
    vi.stubEnv("SENTRY_DSN", "https://example.invalid/1");
    log().error("request_failed", new AppError("store_unavailable", { cause: new Error("PRIVATE") }));
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0]).sort()).toEqual(["code", "fingerprint", "release", "route", "status"]);
    expect(JSON.stringify(seen[0])).not.toContain("PRIVATE");
  });

  it("a throwing reporter costs one warning line and does not throw", () => {
    vi.stubEnv("SENTRY_DSN", "https://example.invalid/1");
    setErrorReporter({
      capture: () => {
        throw new Error("sentry down");
      },
    });
    expect(() => log().error("request_failed", new AppError("internal"))).not.toThrow();
    expect(lines.some((l) => l.includes("error_reporter_failed"))).toBe(true);
    expect(lines.join("")).not.toContain("sentry down");
  });
});
