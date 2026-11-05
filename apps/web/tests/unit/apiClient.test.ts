import { describe, expect, it, vi } from "vitest";
import { createCallApi, type ApiPath } from "@/lib/api/client";
import { PracticeReply } from "@/features/shared/schemas";

const CODE = "ABCDE-FGHJK-LMNPQ-RSTUV";
const REPLY = { clinicianSay: "What brings you in today?", coveredItemIds: [], isLastTurn: false };
const isCrisis = (t: string) => /end it all/i.test(t);

const res = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

function setup(over: { fetchFn?: typeof fetch; online?: boolean; crisis?: (t: string) => boolean; timeoutMs?: number } = {}) {
  const fetchFn = vi.fn(over.fetchFn ?? (async () => res(200, REPLY)));
  const call = createCallApi({
    fetchFn,
    isCrisis: over.crisis ?? isCrisis,
    isOnline: () => over.online ?? true,
    timeoutMs: over.timeoutMs,
  });
  const go = (body: unknown = { turns: [] }, opts?: Parameters<typeof call>[3], path: ApiPath = "/api/practice") => call(path, body, PracticeReply, opts);
  return { fetchFn, go };
}
const headersOf = (fetchFn: ReturnType<typeof setup>["fetchFn"]) => (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>;

describe("callApi: crisis before the network", () => {
  it("crisis text in a nested field returns crisis and never calls fetch", async () => {
    const { fetchFn, go } = setup();
    const r = await go({ plan: { items: [{ id: "q1", text: "I want to end it all" }] } });
    expect(r).toEqual({ ok: false, crisis: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("when the caller names the typed fields, only those are checked", async () => {
    const { fetchFn, go } = setup();
    const body = { turns: [{ role: "clinician", text: "end it all" }] };
    expect(await go(body, { typedText: ["my head hurts"] })).toMatchObject({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await go(body, { typedText: ["I want to end it all"] })).toEqual({ ok: false, crisis: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("a crashing crisis check does not stop the call: the server is the gate", async () => {
    const { fetchFn, go } = setup({
      crisis: () => {
        throw new Error("boom");
      },
    });
    expect(await go({ turns: [{ role: "me", text: "hello" }] })).toMatchObject({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("a circular body cannot hang or throw", async () => {
    const { fetchFn, go } = setup();
    const a: Record<string, unknown> = { text: "hello" };
    a.self = a;
    const r = await go(a);
    expect(r.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("callApi: the crisis flag from the server", () => {
  it("crisis === true is crisis, even on a non-200 status", async () => {
    expect(await setup({ fetchFn: async () => res(200, { crisis: true }) }).go()).toEqual({ ok: false, crisis: true });
    expect(await setup({ fetchFn: async () => res(422, { crisis: true }) }).go()).toEqual({ ok: false, crisis: true });
  });

  it("only boolean true counts: false, 'in', 1 and a nested key do not", async () => {
    expect(await setup({ fetchFn: async () => res(200, { ...REPLY, crisis: false }) }).go()).toMatchObject({ ok: true });
    for (const crisis of ["in", "true", 1, null, { x: 1 }]) {
      const r = await setup({ fetchFn: async () => res(200, { ...REPLY, crisis }) }).go();
      expect(r).toMatchObject({ ok: true });
    }
    expect(await setup({ fetchFn: async () => res(200, { crisis: "in" }) }).go()).toMatchObject({ ok: false, error: { code: "ai_invalid" } });
  });
});

describe("callApi: failures are friendly and never throw", () => {
  it("offline is ai_unavailable and makes no request", async () => {
    const { fetchFn, go } = setup({ online: false });
    expect(await go()).toMatchObject({ ok: false, error: { code: "ai_unavailable" } });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("an error status keeps its code but uses fixed wording, not server text", async () => {
    const r = await setup({ fetchFn: async () => res(429, { error: { code: "rate_limited", message: "SECRET internal detail" } }) }).go();
    expect(r).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect(JSON.stringify(r)).not.toContain("SECRET");
    if (!r.ok && "error" in r) expect(r.error.message.length).toBeGreaterThan(10);
  });

  it("an unknown code or a non-JSON error falls back by status", async () => {
    expect(await setup({ fetchFn: async () => res(429, "<html>") }).go()).toMatchObject({ error: { code: "rate_limited" } });
    expect(await setup({ fetchFn: async () => res(413, { error: { code: "weird" } }) }).go()).toMatchObject({ error: { code: "too_large" } });
    expect(await setup({ fetchFn: async () => res(403, {}) }).go()).toMatchObject({ error: { code: "forbidden" } });
    expect(await setup({ fetchFn: async () => res(400, {}) }).go()).toMatchObject({ error: { code: "bad_input" } });
    expect(await setup({ fetchFn: async () => res(500, "boom") }).go()).toMatchObject({ error: { code: "ai_unavailable" } });
  });

  it("a 200 with the wrong shape, or not JSON, is ai_invalid", async () => {
    expect(await setup({ fetchFn: async () => res(200, { clinicianSay: 5 }) }).go()).toMatchObject({ error: { code: "ai_invalid" } });
    expect(await setup({ fetchFn: async () => res(200, "not json") }).go()).toMatchObject({ error: { code: "ai_invalid" } });
    expect(await setup({ fetchFn: async () => res(200, "null") }).go()).toMatchObject({ error: { code: "ai_invalid" } });
  });

  it("a rejected or throwing fetch is ai_unavailable", async () => {
    const rejecting = setup({ fetchFn: async () => Promise.reject(new Error("net")) });
    expect(await rejecting.go()).toMatchObject({ error: { code: "ai_unavailable" } });
    const throwing = setup({
      fetchFn: (() => {
        throw new Error("sync");
      }) as typeof fetch,
    });
    expect(await throwing.go()).toMatchObject({ error: { code: "ai_unavailable" } });
  });

  it("times out and aborts the request", async () => {
    let aborted = false;
    const slow = (async (_u: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      })) as typeof fetch;
    const r = await setup({ fetchFn: slow, timeoutMs: 20 }).go();
    expect(r).toMatchObject({ ok: false, error: { code: "ai_unavailable" } });
    expect(aborted).toBe(true);
  });

  it("the default timeout is 25 seconds", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const slow = (async (_u: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        })) as typeof fetch;
      const call = createCallApi({ fetchFn: slow, isCrisis, isOnline: () => true });
      const pending = call("/api/plan", { rawText: "x" }, PracticeReply);
      await vi.advanceTimersByTimeAsync(24_999);
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(aborted).toBe(true);
      expect(await pending).toMatchObject({ ok: false });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("callApi: request shape and the x-rumi-key header", () => {
  it("posts JSON to the path with same-origin credentials and parses the reply", async () => {
    const { fetchFn, go } = setup();
    const r = await go({ turns: [] }, undefined, "/api/practice");
    expect(r).toEqual({ ok: true, data: REPLY });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/practice");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBe(JSON.stringify({ turns: [] }));
    expect(headersOf(fetchFn)).toEqual({ "Content-Type": "application/json" });
  });

  it("degraded survives the reply parse", async () => {
    const r = await setup({ fetchFn: async () => res(200, { ...REPLY, degraded: true }) }).go();
    expect(r).toEqual({ ok: true, data: { ...REPLY, degraded: true } });
  });

  it("sends the header only for a valid code", async () => {
    const ok = setup();
    await ok.go({}, { memoryCode: CODE });
    expect(headersOf(ok.fetchFn)["x-rumi-key"]).toBe(CODE);
    for (const bad of [CODE + "\n", "\n" + CODE, CODE.toLowerCase(), CODE + " ", "abc", "", "ABCDE-FGHJK-LMNPQ-RSTUV\r\nX-Evil: 1"]) {
      const s = setup();
      await s.go({}, { memoryCode: bad });
      expect(Object.keys(headersOf(s.fetchFn))).toEqual(["Content-Type"]);
    }
    const none = setup();
    await none.go({}, { memoryCode: undefined });
    expect(Object.keys(headersOf(none.fetchFn))).toEqual(["Content-Type"]);
  });
});
