import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_LISTENER_REPORTS, listenForClientErrors, resetListenerBudget, type ErrorEventTarget } from "@/lib/telemetry/clientErrorListener";

function fakeWindow() {
  const handlers = new Map<string, (event: unknown) => void>();
  const target: ErrorEventTarget = {
    addEventListener: (type, fn) => void handlers.set(type, fn),
    removeEventListener: (type, fn) => void (handlers.get(type) === fn && handlers.delete(type)),
  };
  return { target, handlers, fire: (type: string, event: unknown) => handlers.get(type)?.(event) };
}

beforeEach(() => resetListenerBudget());

describe("listenForClientErrors", () => {
  it("reports a rejected promise and a script error as unhandled_rejection, with the digest only", () => {
    const w = fakeWindow();
    const report = vi.fn();
    listenForClientErrors(w.target, report);
    w.fire("unhandledrejection", { reason: Object.assign(new Error("my head hurts"), { digest: "2349872346" }) });
    w.fire("error", { error: Object.assign(new Error("secret text"), { digest: "abcdef123456" }), message: "secret text" });
    expect(report.mock.calls).toEqual([
      ["unhandled_rejection", "2349872346"],
      ["unhandled_rejection", "abcdef123456"],
    ]);
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/head hurts|secret/);
  });

  it("sends no digest when the reason is a string, null or has no digest, and never reads the message", () => {
    const w = fakeWindow();
    const report = vi.fn();
    listenForClientErrors(w.target, report);
    const hostile = { get message(): string { throw new Error("must not be read"); }, get stack(): string { throw new Error("must not be read"); } };
    for (const reason of ["text only", null, undefined, 42, new Error("x"), hostile]) {
      resetListenerBudget();
      w.fire("unhandledrejection", { reason });
    }
    resetListenerBudget();
    w.fire("error", undefined);
    expect(report.mock.calls).toEqual(Array(7).fill(["unhandled_rejection", undefined]));
  });

  it(`sends at most ${MAX_LISTENER_REPORTS} reports per page load, across both event types`, () => {
    const w = fakeWindow();
    const report = vi.fn();
    listenForClientErrors(w.target, report);
    for (let i = 0; i < 20; i += 1) w.fire(i % 2 === 0 ? "unhandledrejection" : "error", { reason: {}, error: {} });
    expect(report).toHaveBeenCalledTimes(MAX_LISTENER_REPORTS);
  });

  it("the limit belongs to the page, not to one listener: mounting again does not reset it", () => {
    const report = vi.fn();
    const a = fakeWindow();
    listenForClientErrors(a.target, report);
    for (let i = 0; i < 3; i += 1) a.fire("error", {});
    const b = fakeWindow();
    listenForClientErrors(b.target, report);
    b.fire("error", {});
    expect(report).toHaveBeenCalledTimes(3);
  });

  it("the returned function removes both listeners", () => {
    const w = fakeWindow();
    const stop = listenForClientErrors(w.target, vi.fn());
    expect([...w.handlers.keys()].sort()).toEqual(["error", "unhandledrejection"]);
    stop();
    expect(w.handlers.size).toBe(0);
  });
});
