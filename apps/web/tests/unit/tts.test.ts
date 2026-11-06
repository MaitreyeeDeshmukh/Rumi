import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { speakCall } from "@/lib/api/calls";
import { ConfigError, getCartesiaConfig } from "@/lib/env";
import { setLogSink } from "@/lib/ai/telemetry";
import { createRateLimiter } from "@/lib/security/rateLimit";
import { createTtsHandler, ttsHandler } from "@/lib/voice/ttsHandler";
import { synthesize, TtsError } from "@/lib/voice/tts";
import * as route from "@/app/api/voice/tts/route";

const KEY = "sk_car_SECRETKEYVALUE_123456";
const ORIGIN = "https://rumi.test";
const AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]);
const PROVIDER_TEXT = "PROVIDER-SECRET-ERROR-TEXT";

const audioRes = () => new Response(AUDIO, { status: 200, headers: { "content-type": "audio/mpeg" } });
type Call = { url: string; init: RequestInit };
function fake(make: () => Response | Promise<Response> = audioRes) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return make();
  }) as typeof fetch;
  return { fetchFn, calls };
}
const hangs = ((_: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error(PROVIDER_TEXT))))) as typeof fetch;
const limiter = () => createRateLimiter({ limits: { perIp: 1000, perSession: 1000, perInstance: 1000, perUnknownIp: 1000 } });
const handler = (fetchFn: typeof fetch, timeoutMs?: number) => createTtsHandler({ fetchFn, limiter: limiter(), ...(timeoutMs === undefined ? {} : { timeoutMs }) });
const post = (body: unknown, headers: Record<string, string> = {}, raw?: string): Request =>
  new Request(`${ORIGIN}/api/voice/tts`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: raw ?? JSON.stringify(body),
  });
const errBody = async (r: Response) => (await r.json()) as { error: { code: string; message: string } };

let lines: string[];
beforeEach(() => {
  vi.stubEnv("CARTESIA_API_KEY", KEY);
  vi.stubEnv("CARTESIA_VERSION", "");
  lines = [];
  setLogSink((l) => lines.push(l));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setLogSink(null);
});

describe("getCartesiaConfig", () => {
  it("returns the key and the default version when CARTESIA_VERSION is empty", () => {
    expect(getCartesiaConfig()).toEqual({ apiKey: KEY, version: "2026-08-14" });
  });
  it("uses CARTESIA_VERSION when set", () => {
    vi.stubEnv("CARTESIA_VERSION", "2030-01-01");
    expect(getCartesiaConfig().version).toBe("2030-01-01");
  });
  it("throws ConfigError naming the variable, not a value, when the key is missing or blank", () => {
    for (const v of ["", "   "]) {
      vi.stubEnv("CARTESIA_API_KEY", v);
      try {
        getCartesiaConfig();
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigError);
        expect((e as ConfigError).names).toEqual(["CARTESIA_API_KEY"]);
      }
    }
  });
});

describe("synthesize: the request sent to Cartesia", () => {
  it("sends the key and version headers, the model, the voice and the text, and nothing else", async () => {
    const { fetchFn, calls } = fake();
    const speech = await synthesize("Hello there", { fetchFn });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.cartesia.ai/tts/bytes");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({ "X-API-Key": KEY, "Cartesia-Version": "2026-08-14", "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model_id: "sonic-3.6",
      transcript: "Hello there",
      voice: { id: "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc" },
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
      language: "en",
    });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(speech.contentType).toBe("audio/mpeg");
    expect(new Uint8Array(speech.bytes)).toEqual(AUDIO);
  });

  it("no key: throws TtsError config and never calls the network", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "");
    const { fetchFn, calls } = fake();
    await expect(synthesize("hi", { fetchFn })).rejects.toMatchObject({ kind: "config" });
    expect(calls).toHaveLength(0);
  });

  it.each([400, 401, 429, 500, 503])("a %i answer is TtsError http without the provider text", async (status) => {
    const { fetchFn } = fake(() => new Response(PROVIDER_TEXT, { status }));
    const err = await synthesize("hi", { fetchFn }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TtsError);
    expect((err as TtsError).kind).toBe("http");
    expect(String((err as Error).message) + String((err as Error).stack)).not.toContain(PROVIDER_TEXT);
  });

  it("a request that never answers is aborted at the deadline", async () => {
    const err = await synthesize("hi", { fetchFn: hangs, timeoutMs: 20 }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "timeout" });
    expect(String((err as Error).message)).not.toContain(PROVIDER_TEXT);
  });

  it("an empty body or a non-audio 200 is TtsError empty", async () => {
    const empties = [() => new Response(new Uint8Array(0), { headers: { "content-type": "audio/mpeg" } }), () => new Response("<html>", { headers: { "content-type": "text/html" } })];
    for (const make of empties) {
      await expect(synthesize("hi", { fetchFn: fake(make).fetchFn })).rejects.toMatchObject({ kind: "empty" });
    }
  });
});

describe("the route handler", () => {
  it("accepts a valid body and returns the audio with the right headers", async () => {
    const { fetchFn, calls } = fake();
    const r = await handler(fetchFn)(post({ text: "  Hello   there  " }));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("audio/mpeg");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(AUDIO);
    expect(JSON.parse(String(calls[0].init.body)).transcript).toBe("Hello there");
  });

  it("appends the session cookie to the answer, like the other routes", async () => {
    const r = await handler(fake().fetchFn)(post({ text: "Hi" }));
    expect(r.headers.get("set-cookie")).toMatch(/^[^=]+=/);
  });

  it("cleans the text: control and invisible characters and region tokens do not reach Cartesia", async () => {
    const { fetchFn, calls } = fake();
    await handler(fetchFn)(post({ text: "Hi​ <<<FACTS>>> there\u0007" }));
    const sent = JSON.parse(String(calls[0].init.body)).transcript as string;
    expect(sent).not.toMatch(/[​\u0007]|<<<|>>>/);
    expect(sent).toContain("Hi");
  });

  it("speaks crisis wording like any other text: no special path", async () => {
    const { fetchFn, calls } = fake();
    const r = await handler(fetchFn)(post({ text: "If you are in danger, call 988 now." }));
    expect(r.status).toBe(200);
    expect(JSON.parse(String(calls[0].init.body)).transcript).toBe("If you are in danger, call 988 now.");
  });

  it("accepts exactly 600 characters", async () => {
    expect((await handler(fake().fetchFn)(post({ text: "a".repeat(600) }))).status).toBe(200);
  });

  describe("rejections never reach Cartesia and are fixed JSON bodies", () => {
    const cases: [string, () => Request, number, string][] = [
      ["wrong origin", () => post({ text: "Hi" }, { origin: "https://evil.test" }), 403, "forbidden"],
      ["no origin headers", () => new Request(`${ORIGIN}/api/voice/tts`, { method: "POST", body: JSON.stringify({ text: "Hi" }) }), 403, "forbidden"],
      ["declared oversize body", () => post({ text: "Hi" }, { "content-length": "4097" }), 413, "too_large"],
      ["streamed oversize body", () => post(null, {}, JSON.stringify({ text: "Hi", pad: "x".repeat(5000) })), 413, "too_large"],
      ["empty text", () => post({ text: "" }), 400, "bad_input"],
      ["blank text", () => post({ text: "  \n\t " }), 400, "bad_input"],
      ["text that cleans to nothing", () => post({ text: "​​" }), 400, "bad_input"],
      ["601 characters", () => post({ text: "a".repeat(601) }), 400, "bad_input"],
      ["text that grows past 600 when cleaned", () => post({ text: "…".repeat(300) }), 400, "bad_input"],
      ["unknown field", () => post({ text: "Hi", voice: "other" }), 400, "bad_input"],
      ["missing field", () => post({}), 400, "bad_input"],
      ["text not a string", () => post({ text: 5 }), 400, "bad_input"],
      ["bad JSON", () => post(null, {}, "{not json"), 400, "bad_input"],
      ["invalid recovery key header", () => post({ text: "Hi" }, { "x-rumi-key": "nope" }), 400, "bad_input"],
    ];
    it.each(cases)("%s", async (_name, make, status, code) => {
      const { fetchFn, calls } = fake();
      const r = await handler(fetchFn)(make());
      expect(r.status).toBe(status);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.headers.get("content-type")).toBe("application/json");
      expect((await errBody(r)).error.code).toBe(code);
      expect(calls).toHaveLength(0);
    });
  });

  it("no key: a fixed 503 ai_unavailable and no network call", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "");
    const { fetchFn, calls } = fake();
    const r = await handler(fetchFn)(post({ text: "Hi" }));
    expect(r.status).toBe(503);
    expect((await errBody(r)).error.code).toBe("ai_unavailable");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(calls).toHaveLength(0);
  });

  it.each([400, 401, 429, 500, 503])("Cartesia %i: a fixed 503 body with no provider text", async (status) => {
    const r = await handler(fake(() => new Response(PROVIDER_TEXT, { status })).fetchFn)(post({ text: "Hi" }));
    const raw = await r.text();
    expect(r.status).toBe(503);
    expect(JSON.parse(raw).error.code).toBe("ai_unavailable");
    expect(raw).not.toContain(PROVIDER_TEXT);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("a Cartesia timeout is a fixed 503 body", async () => {
    const r = await handler(hangs, 20)(post({ text: "Hi" }));
    const raw = await r.text();
    expect(r.status).toBe(503);
    expect(JSON.parse(raw).error.code).toBe("ai_unavailable");
    expect(raw).not.toContain(PROVIDER_TEXT);
  });

  it("the stricter limit: the 31st call from one client in ten minutes is a 429 with Retry-After", async () => {
    const { fetchFn, calls } = fake();
    const h = createTtsHandler({ fetchFn });
    const headers = { "x-real-ip": "203.0.113.77" };
    let last!: Response;
    for (let i = 0; i < 31; i++) last = await h(post({ text: "Hi" }, headers));
    expect(last.status).toBe(429);
    expect((await errBody(last)).error.code).toBe("rate_limited");
    expect(last.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(calls).toHaveLength(30);
  });

  it("neither the key nor the text appears in any response or log line, and nothing is logged", async () => {
    const spy = vi.spyOn(console, "log");
    const out: string[] = [];
    for (const make of [audioRes, () => new Response(PROVIDER_TEXT, { status: 500 })]) {
      for (const t of ["Secret sentence about my knee", "second private sentence"]) {
        const r = await handler(fake(make).fetchFn)(post({ text: t }));
        out.push([...r.headers].map(([k, v]) => `${k}:${v}`).join("\n"));
        if (r.status !== 200) out.push(await r.text());
      }
    }
    out.push(...lines, ...spy.mock.calls.map((c) => c.join(" ")));
    const all = out.join("\n");
    expect(all).not.toContain(KEY);
    expect(all).not.toContain("SECRETKEYVALUE");
    expect(all).not.toContain("knee");
    expect(all).not.toContain(PROVIDER_TEXT);
    expect(lines).toEqual([]);
  });

  it("the route file: nodejs, dynamic, maxDuration 30, POST is the real handler (wrong origin is refused, no network)", async () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(30);
    const spy = vi.fn(async () => audioRes());
    vi.stubGlobal("fetch", spy);
    const r = await route.POST(post({ text: "Hi" }, { origin: "https://evil.test" }));
    expect(r.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
    expect(typeof ttsHandler).toBe("function");
  });
});

describe("speakCall (browser side)", () => {
  const audioInit = { headers: { "content-type": "audio/mpeg" } };

  it("posts {text} to /api/voice/tts and returns the audio blob", async () => {
    const { fetchFn, calls } = fake();
    const blob = await speakCall("Hello", { fetchFn });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.size).toBe(AUDIO.length);
    expect(calls[0].url).toBe("/api/voice/tts");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.credentials).toBe("same-origin");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: "Hello" });
  });

  it("returns null on an error status, a non-audio answer, an empty body, a throw, a cut-off body and a timeout", async () => {
    const makers = [
      () => new Response('{"error":{"code":"ai_unavailable"}}', { status: 503, headers: { "content-type": "application/json" } }),
      () => new Response(AUDIO, { headers: { "content-type": "text/html" } }),
      () => new Response(new Uint8Array(0), audioInit),
      () => ({ ok: true, headers: new Headers(audioInit.headers), blob: async () => Promise.reject(new Error("cut off")) }) as unknown as Response,
    ];
    for (const make of makers) expect(await speakCall("Hello", { fetchFn: fake(make).fetchFn })).toBeNull();
    expect(await speakCall("Hello", { fetchFn: (async () => Promise.reject(new Error("offline"))) as typeof fetch })).toBeNull();
    const real = AbortSignal;
    vi.stubGlobal("AbortSignal", { timeout: () => real.abort() });
    expect(await speakCall("Hello", { fetchFn: ((_: RequestInfo | URL, init?: RequestInit) => (init?.signal?.aborted ? Promise.reject(new Error("aborted")) : Promise.resolve(audioRes()))) as typeof fetch })).toBeNull();
  });

  it("returns null for an audio answer above the size cap", async () => {
    const big = () => new Response(new Uint8Array(5_000_001), audioInit);
    expect(await speakCall("Hello", { fetchFn: fake(big).fetchFn })).toBeNull();
  });
});
