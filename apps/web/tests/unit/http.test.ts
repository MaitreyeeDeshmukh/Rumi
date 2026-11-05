import { describe, expect, it } from "vitest";
import { HttpError, errorResponse, json, readJson } from "@/lib/ai/http";

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

describe("json and errorResponse", () => {
  it("every answer is JSON and never cached", async () => {
    const res = json({ ok: true });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("maps a code to a plain message and the status", async () => {
    const res = errorResponse(new HttpError(403, "forbidden"));
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Retry-After")).toBeNull();
    expect(await res.json()).toEqual({ error: { code: "forbidden", message: "This request was blocked. Reload the page and try again." } });
  });

  it("a 429 carries Retry-After, rounded up, with a default of 60", () => {
    expect(errorResponse(new HttpError(429, "rate_limited", 12.2)).headers.get("Retry-After")).toBe("13");
    expect(errorResponse(new HttpError(429, "rate_limited")).headers.get("Retry-After")).toBe("60");
    expect(errorResponse(new HttpError(429, "rate_limited", 0)).headers.get("Retry-After")).toBe("1");
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
    await expect(readJson(post(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d])), 1000)).rejects.toMatchObject({ status: 400 });
    await expect(readJson(post(null), 1000)).rejects.toMatchObject({ status: 400 });
  });
});
