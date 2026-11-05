/**
 * Test doubles for the chaos suite: captured logs, a fake task spec, a scripted Groq (as a `fetch`), request builders.
 * Everything that must never leak has a distinctive marker so a leak is a plain substring search.
 */
import { expect, vi } from "vitest";
import { z } from "zod";
import { COMPANION_RE } from "@/features/shared/constants";
import type { TaskSpec } from "@/features/shared/task";
import { setLogSink } from "@/lib/ai/telemetry";
import { buildLedger } from "@/lib/ai/ledger";

/** What the user typed. No crisis words, no PII shapes, so only the leak check can trip on it. */
export const USER_TEXT = "ZEBRA-MARIGOLD walked to the clinic and felt tired in the morning";
/** A provider key and a thrown error message: neither may appear in a log line or a response body. */
export const FAKE_KEY = "gsk_CHAOSKEY0123456789abcdefghij";
export const ERR_MESSAGE = "BOOM-internal-detail-8f3a";
export const FORBIDDEN = ["ZEBRA-MARIGOLD", FAKE_KEY, ERR_MESSAGE];

// ---------------------------------------------------------------- logs

export interface Logs {
  lines: string[];
  stop(): void;
}

/** Captures every line the app can print: the telemetry sink, console.* and process.stdout/stderr writes. */
export function captureLogs(): Logs {
  const lines: string[] = [];
  const push = (...a: unknown[]): void => void lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  setLogSink((l) => lines.push(l));
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(push));
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => (push(String(chunk)), true));
  const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => (push(String(chunk)), true));
  return {
    lines,
    stop() {
      setLogSink(null);
      for (const s of [...spies, out, err]) s.mockRestore();
    },
  };
}

/** Every chaos case ends here: something was logged (so capture works; pass requireLines=false where logging is optional) and none of it holds user text, a key or an error message. */
export function expectNoLeak(logs: Logs, body = "", requireLines = true): void {
  if (requireLines) expect(logs.lines.length, "nothing was logged, so the leak check proves nothing").toBeGreaterThan(0);
  const all = `${logs.lines.join("\n")}\n${body}`;
  for (const secret of FORBIDDEN) expect(all, `leaked ${secret.slice(0, 8)}...`).not.toContain(secret);
}

// ---------------------------------------------------------------- env

/** The variables a live provider call reads. Values are fake. Call `vi.unstubAllEnvs()` in afterEach. */
export function stubLiveEnv(): void {
  vi.stubEnv("GROQ_API_KEY", FAKE_KEY);
  vi.stubEnv("GROQ_MODEL_QUALITY", "model-quality-x");
  vi.stubEnv("GROQ_MODEL_FAST", "model-fast-y");
  vi.stubEnv("SESSION_SECRET", "chaos-session-secret-0123456789-abcdef-xyz");
  vi.stubEnv("MOCK_AI", "");
}

// ---------------------------------------------------------------- a task spec

export interface Req {
  text: string;
  companionName: string;
}
export interface Out {
  say: string;
  crisis: boolean;
}
export interface Reply {
  say: string;
  degraded?: boolean;
}

/** The smallest valid TaskSpec. Its fallback never repeats the user's text. */
export function chaosSpec(): TaskSpec<Req, Out, Reply> {
  return {
    name: "plan",
    promptVersion: "plan@1",
    tier: "quality",
    request: z.object({ text: z.string().trim().min(1).max(2000), companionName: z.string().regex(COMPANION_RE) }),
    modelOut: z.object({ say: z.string().min(1).max(300), crisis: z.boolean() }),
    reply: z.object({ say: z.string(), degraded: z.boolean().optional() }),
    crisisFields: (r) => ({ text: r.text }),
    buildLedger: (r) => buildLedger({ rawText: r.text }),
    build: (ctx) => ({ system: "PERSONA", user: `TASK ${ctx.fence("text", ctx.r.text)}` }),
    validate: () => [],
    finalize: (_r, o) => ({ say: o.say }),
    fallback: () => ({ say: "Here is a plain answer you can edit." }),
    adviceGuard: true,
    useMemory: false,
    temperature: 0.3,
    maxOutputTokens: 700,
    mock: () => ({ say: "mock" }),
  };
}

let ip = 0;
/** A same-origin browser-like POST with its own client address (so rate limits never collide between tests). */
export function post(body: unknown = { text: USER_TEXT, companionName: "Rumi" }, headers: Record<string, string> = {}, raw?: string | Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>): Request {
  ip += 1;
  const init: RequestInit & { duplex?: "half" } = {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json", "x-real-ip": `203.0.113.${(ip % 250) + 1}`, ...headers },
    body: raw ?? JSON.stringify(body),
  };
  if (raw instanceof ReadableStream) init.duplex = "half";
  return new Request("https://rumi.test/api/plan", init);
}

// ---------------------------------------------------------------- a scripted Groq (a fetch)

export type FetchStep = (init: RequestInit | undefined) => Promise<Response>;

const completion = (content: string | null): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 50, completion_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } });

export const groq = {
  /** A good answer. */
  ok: (say = "Here is a short answer."): FetchStep => async () => completion(JSON.stringify({ say, crisis: false })),
  /** HTTP error with the body the real service would send; the body contains the marker so a copy would be caught. */
  status: (status: number, headers: Record<string, string> = {}): FetchStep => async () =>
    new Response(JSON.stringify({ error: { message: ERR_MESSAGE, key: FAKE_KEY } }), { status, headers }),
  /** 200 with text that is not JSON. */
  badJson: (): FetchStep => async () => completion(`not json ${ERR_MESSAGE}`),
  /** 200 with an empty or null message: how a safety refusal usually looks. */
  refusal: (): FetchStep => async () => completion(null),
  /** Never answers until the caller aborts it, like a stalled connection. */
  hang: (): FetchStep => (init) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException(ERR_MESSAGE, "AbortError")));
    }),
  /** Network failure with a message that carries internals. */
  network: (): FetchStep => async () => {
    throw new TypeError(`fetch failed: ${ERR_MESSAGE}`);
  },
};

/** A `fetch` that plays the steps in order; the last step repeats. `calls` counts requests. */
export function scriptedFetch(...steps: FetchStep[]): typeof fetch & { calls: number } {
  const fn = (async (_url: unknown, init?: RequestInit) => {
    const step = steps[Math.min(fn.calls, steps.length - 1)];
    fn.calls += 1;
    return step(init);
  }) as typeof fetch & { calls: number };
  fn.calls = 0;
  return fn;
}
