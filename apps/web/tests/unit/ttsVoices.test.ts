import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { speakCall } from "@/lib/api/calls";
import { createRateLimiter } from "@/lib/security/rateLimit";
import { createTtsHandler } from "@/lib/voice/ttsHandler";
import { DEFAULT_VOICE, VOICES, VOICE_KEYS, VOICE_OPTIONS, voiceIdFor } from "@/lib/voice/voices";

const ORIGIN = "https://rumi.test";
const AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]);

function fake() {
  const bodies: Array<{ voice: { id: string } }> = [];
  const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as { voice: { id: string } });
    return new Response(AUDIO, { status: 200, headers: { "content-type": "audio/mpeg" } });
  }) as typeof fetch;
  return { fetchFn, bodies };
}
const limiter = () => createRateLimiter({ limits: { perIp: 1000, perSession: 1000, perInstance: 1000, perUnknownIp: 1000 } });
const post = (body: unknown): Request =>
  new Request(`${ORIGIN}/api/voice/tts`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv("CARTESIA_API_KEY", "sk_car_TESTKEY_123456");
  vi.stubEnv("CARTESIA_VERSION", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("voice choices", () => {
  it("offers at least two female and two male voices, with unique keys and ids", () => {
    expect(VOICES.filter((v) => v.gender === "female").length).toBeGreaterThanOrEqual(2);
    expect(VOICES.filter((v) => v.gender === "male").length).toBeGreaterThanOrEqual(2);
    expect(new Set(VOICES.map((v) => v.key)).size).toBe(VOICES.length);
    expect(new Set(VOICES.map((v) => v.id)).size).toBe(VOICES.length);
    expect(VOICE_KEYS).toContain(DEFAULT_VOICE);
  });

  it("the list for a picker carries no Cartesia ids", () => {
    for (const o of VOICE_OPTIONS) expect(Object.keys(o).sort()).toEqual(["gender", "key", "label", "note"]);
  });

  it.each(VOICES.map((v) => [v.key, v.id] as const))("voice %s sends exactly its own id to Cartesia", async (key, id) => {
    const { fetchFn, bodies } = fake();
    const res = await createTtsHandler({ fetchFn, limiter: limiter() })(post({ text: "Hello there.", voice: key }));
    expect(res.status).toBe(200);
    expect(bodies[0].voice).toEqual({ id });
    expect(voiceIdFor(key)).toBe(id);
  });

  it("no voice given means the default voice", async () => {
    const { fetchFn, bodies } = fake();
    await createTtsHandler({ fetchFn, limiter: limiter() })(post({ text: "Hello there." }));
    expect(bodies[0].voice).toEqual({ id: voiceIdFor(DEFAULT_VOICE) });
  });

  it.each(["", "Jacqueline", "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc", "../x", 5, null])("an unlisted voice (%j) is a 400 and Cartesia is never called", async (voice) => {
    const { fetchFn, bodies } = fake();
    const res = await createTtsHandler({ fetchFn, limiter: limiter() })(post({ text: "Hello there.", voice }));
    expect(res.status).toBe(400);
    expect(bodies).toHaveLength(0);
  });

  it("speakCall sends the chosen voice, and nothing extra when none is chosen", async () => {
    const sent: unknown[] = [];
    const fetchFn = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(AUDIO, { status: 200, headers: { "content-type": "audio/mpeg" } });
    }) as typeof fetch;
    await speakCall("Hi", { fetchFn, voice: "zander" });
    await speakCall("Hi", { fetchFn });
    expect(sent).toEqual([{ text: "Hi", voice: "zander" }, { text: "Hi" }]);
  });
});
