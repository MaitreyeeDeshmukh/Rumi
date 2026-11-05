import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
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

  it("writes only allowlisted fields: everything else is dropped, whatever its name or value", () => {
    log().info("x", {
      // names the old denylist caught
      text: "my knee hurts",
      email: "a@b.co",
      accessToken: "t",
      userId: "u1",
      // names the old denylist missed
      msg: "I take 50mg",
      err: "boom",
      error: "boom",
      detail: "private",
      name: "Jane",
      phone: "5551234567",
      addr: "1 Main St",
      ip: "203.0.113.7",
      sid: "abc",
      session: "abc",
      jwt: "eyJhbGciOiJIUzI1NiJ9.payload.sig",
      pwd: "p",
      auth: "x",
      sub: "uuid",
      note: "private",
      answer: "private",
      reply: "private",
      input: "private",
      query: "private",
      firstName: "Jane",
      somethingNew: "anything",
      // allowed
      code: "ai_unavailable",
      count: 2,
    });
    const o = out()[0];
    const extra = Object.keys(o).filter((k) => !["ts", "level", "event", "requestId", "route", "release"].includes(k));
    expect(extra.sort()).toEqual(["code", "count"]);
    expect(lines[0]).not.toMatch(/knee|50mg|Jane|5551234567|Main St|203\.0|eyJ/);
  });

  it("checks the value of an allowed field too: prose, emails, tokens, uuids and wrong types never print", () => {
    log().info("x", { code: "write to jane.doe@example.com please", reason: "sk-live1234567890abcdef", area: "a1b2c3d4-1111-4222-8333-444455556666", task: "My Knee Hurts", digest: "<script>", status: "500" as never, count: "3" as never, ok: "yes" as never });
    const line = lines[0];
    for (const leak of ["jane.doe", "sk-live", "a1b2c3d4-1111", "My Knee", "<script>"]) expect(line, leak).not.toContain(leak);
    const o = out()[0];
    expect([o.code, o.reason, o.area, o.task, o.digest]).toEqual(["[redacted]", "[redacted]", "[redacted]", "[redacted]", "[redacted]"]);
    expect(o).not.toHaveProperty("status");
    expect(o).not.toHaveProperty("count");
    expect(o).not.toHaveProperty("ok");
  });

  it("accepts a numeric digest and a 16-hex fingerprint only", () => {
    log().info("x", { digest: "2349872346", fingerprint: "0123456789abcdef" });
    log().info("x", { digest: "12", fingerprint: "NOT-HEX" });
    const [good, bad] = out();
    expect([good.digest, good.fingerprint]).toEqual(["2349872346", "0123456789abcdef"]);
    expect([bad.digest, bad.fingerprint]).toEqual(["[redacted]", "[redacted]"]);
  });

  it("hashes a long string (HMAC, stable) instead of printing it", () => {
    const longText = "I have been feeling pain in my left knee for three weeks and I do not know what to tell the doctor. ".repeat(5);
    log().info("x", { reason: longText });
    log().info("x", { reason: longText });
    log().info("x", { reason: longText + "!" });
    const [a, b, c] = out();
    expect(lines.join("")).not.toMatch(/feeling pain|left knee/);
    expect(String(a.reason)).toMatch(/^h:[0-9a-f]{12}$/);
    expect(b.reason).toBe(a.reason);
    expect(c.reason).not.toBe(a.reason);
  });

  it("the hash marker is keyed: it is not a bare sha256 of the text", () => {
    const text = "x".repeat(200);
    log().info("x", { reason: text });
    const plain = createHash("sha256").update(text).digest("hex").slice(0, 12);
    expect(String(out()[0].reason)).not.toBe(`h:${plain}`);
  });

  it("lets plain short codes and variable-name lists through", () => {
    log().info("x", { reason: "store_unavailable_after_retry", area: "ai", names: "next_public_supabase_url,next_public_supabase_publishable_key,supabase_secret_key" });
    const o = out()[0];
    expect([o.reason, o.area]).toEqual(["store_unavailable_after_retry", "ai"]);
    expect(o.names).toBe("next_public_supabase_url,next_public_supabase_publishable_key,supabase_secret_key");
  });

  it("cannot be spoofed: fields never overwrite ts, level, event, requestId, route or release", () => {
    log().info("real_event", { level: "debug", ts: "yesterday", requestId: "evil", route: "/evil", release: "evil", event: "evil" } as never);
    const o = out()[0];
    expect([o.level, o.event, o.requestId, o.route]).toEqual(["info", "real_event", RID, "/api/plan"]);
    expect(o.ts).not.toBe("yesterday");
    expect(o.release).not.toBe("evil");
  });

  it("cannot be tricked with a field called __proto__ or constructor", () => {
    const fields = JSON.parse('{"__proto__": {"code": "x"}, "constructor": "y", "toString": "z", "count": 1}') as never;
    expect(() => log().info("x", fields)).not.toThrow();
    expect(Object.keys(out()[0]).filter((k) => !["ts", "level", "event", "requestId", "route", "release"].includes(k))).toEqual(["count"]);
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
      log().info("x", { count: Number.NaN, ms: undefined, code: { nested: "x" } as never, ...many });
      redactFields(null as never);
    }).not.toThrow();
    expect(Object.keys(out()[0]).length).toBeLessThan(15);
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
