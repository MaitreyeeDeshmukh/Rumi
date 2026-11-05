/**
 * Chaos: something throws with sensitive text in it. The logger and the error responder are the last line of defence, so
 * they are tested directly: whatever is thrown, the line and the answer carry no user text, no email, no key and no
 * e.message. Written against the frozen interfaces (addendum section 3); runs when the observability lane is merged.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { describeWhen } from "./lanes";
import { loadLane, type ErrorsModule, type LogModule } from "./frozen";
import { captureLogs, ERR_MESSAGE, expectNoLeak, FAKE_KEY, USER_TEXT, type Logs } from "./fakes";

let logs: Logs;
beforeEach(() => {
  logs = captureLogs();
  vi.resetModules();
});
afterEach(() => logs.stop());

// Waiting for lane observability: src/lib/log.ts
describeWhen("observability", ["lib/log"], "chaos: the logger is handed text, secrets and errors", () => {
  const ctx = { requestId: "0b9e2f5c-1111-4222-8333-444455556666", route: "/api/plan" };

  it("drops fields whose names say text, body, email, token, key, secret, password, authorization", async () => {
    const { createLogger } = await loadLane<LogModule>("lib/log");
    createLogger(ctx).info("task_done", { text: USER_TEXT, body: USER_TEXT, content: USER_TEXT, prompt: USER_TEXT, message: USER_TEXT, email: "ZEBRA@example.test", token: FAKE_KEY, apiKey: FAKE_KEY, secret: FAKE_KEY, password: FAKE_KEY, authorization: `Bearer ${FAKE_KEY}`, attempts: 2 });
    expectNoLeak(logs);
    expect(logs.lines.join("\n")).not.toContain("ZEBRA@example.test");
    expect(logs.lines.join("\n")).toContain("task_done");
  });

  it("a long string value is replaced by a stable marker, not written out", async () => {
    const { createLogger } = await loadLane<LogModule>("lib/log");
    const long = `${USER_TEXT} `.repeat(10);
    createLogger(ctx).warn("odd_value", { detail: long });
    createLogger(ctx).warn("odd_value", { detail: long });
    expectNoLeak(logs);
    const [a, b] = logs.lines.filter((l) => l.includes("odd_value")).map((l) => JSON.parse(l) as { detail?: unknown });
    expect(typeof a.detail).toBe("string");
    expect(a.detail).not.toBe(long);
    expect((a.detail as string).length).toBeLessThanOrEqual(120);
    expect(a.detail, "the same value must give the same marker").toBe(b.detail);
  });

  it("an Error's message is never written, whatever it says", async () => {
    const { createLogger } = await loadLane<LogModule>("lib/log");
    createLogger(ctx).error("task_failed", new Error(`${ERR_MESSAGE} ${USER_TEXT} ${FAKE_KEY}`), { attempts: 3 });
    createLogger(ctx).error("task_failed", new TypeError(ERR_MESSAGE));
    createLogger(ctx).error("task_failed", { message: ERR_MESSAGE, nested: { text: USER_TEXT } });
    createLogger(ctx).error("task_failed", ERR_MESSAGE);
    createLogger(ctx).error("task_failed", null);
    expectNoLeak(logs);
  });

  it("every line is one line of JSON carrying the request id", async () => {
    const { createLogger } = await loadLane<LogModule>("lib/log");
    createLogger(ctx).info("a");
    createLogger(ctx).error("b", new Error(ERR_MESSAGE));
    expect(logs.lines.length).toBeGreaterThanOrEqual(2);
    for (const line of logs.lines) {
      expect(line.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(line)).toBeTypeOf("object");
      expect(line).toContain(ctx.requestId);
    }
  });
});

// Waiting for lane observability: src/lib/errors.ts
describeWhen("observability", ["lib/errors"], "chaos: errors become safe responses", () => {
  const rid = "0b9e2f5c-1111-4222-8333-444455556666";

  it("an arbitrary Error becomes a 500 with a code, a plain sentence and the request id, and never its message", async () => {
    const { toResponse } = await loadLane<ErrorsModule>("lib/errors");
    const res = toResponse(new Error(`${ERR_MESSAGE} ${USER_TEXT} ${FAKE_KEY}`), rid);
    const body = await res.text();
    expect(res.status).toBe(500);
    for (const secret of [ERR_MESSAGE, USER_TEXT, FAKE_KEY]) expect(body).not.toContain(secret);
    expect(JSON.parse(body)).toMatchObject({ error: { requestId: rid } });
    expect(typeof JSON.parse(body).error.code).toBe("string");
    expect(typeof JSON.parse(body).error.message).toBe("string");
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it.each([[null], [undefined], ["a thrown string " + ERR_MESSAGE], [{ message: ERR_MESSAGE }], [42]])("a thrown non-Error (%#) is a safe 500, not a crash", async (value) => {
    const { toResponse } = await loadLane<ErrorsModule>("lib/errors");
    const res = toResponse(value, rid);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(ERR_MESSAGE);
  });

  it("the fingerprint is 16 hex characters, ignores the message, and differs by call site", async () => {
    const { fingerprintOf } = await loadLane<ErrorsModule>("lib/errors");
    const make = (m: string): Error => new Error(m);
    const a = fingerprintOf(make("first message"));
    const b = fingerprintOf(make(`${ERR_MESSAGE} different`));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a, "same code and same place must group together whatever the message").toBe(b);
    const elsewhere = fingerprintOf(new Error("first message"));
    expect(elsewhere).not.toBe(a);
    expect(a).not.toContain(ERR_MESSAGE);
  });
});
