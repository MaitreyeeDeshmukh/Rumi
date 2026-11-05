import { describe, expect, it } from "vitest";
import { HttpError, json, readJson, retryAfter } from "@/lib/ai/http";

const post = (body: BodyInit | null, headers: Record<string, string> = {}): Request =>
  new Request("https://rumi.test/api/plan", { method: "POST", body, headers });

function streamOf(chunks: number, size: number, pulled: { n: number }, headers: Record<string, string> = {}): Request {
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.n >= chunks) controller.close();
      else {
        pulled.n += 1;
        controller.enqueue(new Uint8Array(size).fill(0x20));
      }
    },
  }, { highWaterMark: 0 });
  return new Request("https://rumi.test/api/plan", { method: "POST", body: stream, headers, duplex: "half" } as RequestInit & { duplex: "half" });
}

describe("json and retryAfter", () => {
  it("every answer is JSON and never cached", async () => {
    const res = json({ ok: true });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("Retry-After is rounded up, with a default of 60", () => {
    expect(retryAfter(12.2)).toBe(13);
    expect(retryAfter(undefined)).toBe(60);
    expect(retryAfter(0)).toBe(1);
  });
});

describe("readJson", () => {
  it("parses a small body", async () => {
    expect(await readJson(post(JSON.stringify({ a: 1 })), 1000)).toEqual({ a: 1 });
  });

  it("rejects by Content-Length before reading anything", async () => {
    const pulled = { n: 0 };
    const req = streamOf(5, 10, pulled, { "content-length": "999999" });
    await expect(readJson(req, 64_000)).rejects.toMatchObject({ status: 413, code: "too_large" });
    expect(pulled.n).toBe(0);
  });

  it("rejects a Content-Length that is not a number", async () => {
    await expect(readJson(post("{}", { "content-length": "12abc" }), 1000)).rejects.toMatchObject({ status: 400 });
  });

  it("stops reading a stream that has no length once it passes the cap", async () => {
    const pulled = { n: 0 };
    await expect(readJson(streamOf(1000, 10_000, pulled), 64_000)).rejects.toMatchObject({ status: 413, code: "too_large" });
    expect(pulled.n).toBeLessThan(12);
  });

  it("accepts a body exactly at the cap and rejects one byte over", async () => {
    const pad = (n: number): string => JSON.stringify({ t: "x".repeat(n - 8) });
    expect(Buffer.byteLength(pad(100))).toBe(100);
    await expect(readJson(post(pad(100)), 100)).resolves.toBeDefined();
    await expect(readJson(post(pad(101)), 100)).rejects.toMatchObject({ status: 413 });
  });

  it("counts bytes, not characters", async () => {
    const body = JSON.stringify({ t: "é".repeat(60) });
    expect(body.length).toBeLessThan(80);
    await expect(readJson(post(body), 80)).rejects.toMatchObject({ status: 413 });
  });

  it("returns 400 for invalid JSON, invalid UTF-8 and a missing body", async () => {
    await expect(readJson(post("{nope"), 1000)).rejects.toMatchObject({ status: 400, code: "bad_input" });
    // valid JSON apart from one byte that is not UTF-8: {"a":"<0xFF>"}
    const badByte = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]);
    await expect(readJson(post(badByte), 1000)).rejects.toMatchObject({ status: 400 });
    await expect(readJson(post(null), 1000)).rejects.toMatchObject({ status: 400 });
  });
});

describe("07 P3 and H-17 details", () => {
  it("Retry-After is a whole number between 1 and 86400 (a day) even for NaN, Infinity or negative input", () => {
    for (const [input, expected] of [[Number.NaN, "60"], [Number.POSITIVE_INFINITY, "60"], [-5, "1"], [999_999, "86400"], [7_200, "7200"], [0.2, "1"]] as const) {
      expect(String(retryAfter(input))).toBe(expected);
    }
  });

  it("cancels the request stream as soon as the cap is passed", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array(10_000).fill(0x20));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const req = new Request("https://rumi.test/api/plan", { method: "POST", body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    await expect(readJson(req, 25_000)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });

  it("drops a __proto__ key from the body, at any depth, so a later merge cannot be abused", async () => {
    const parsed = (await readJson(post('{"a":1,"__proto__":{"polluted":true},"b":{"__proto__":{"x":1},"c":2}}'), 1000)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["a", "b"]);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.keys(parsed.b as object)).toEqual(["c"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
