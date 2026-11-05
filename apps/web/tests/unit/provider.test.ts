import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError, createGroqProvider, type ProviderCall, type ProviderErrorKind } from "@/lib/ai/provider";

const URL_RE = /^https:\/\/api\.groq\.com\/openai\/v1\/chat\/completions$/;
const KEY = "gsk_TESTKEYTESTKEYTESTKEYTESTKEY";

const call = (over: Partial<ProviderCall> = {}): ProviderCall => ({
  tier: "quality",
  system: "SYSTEM TEXT",
  user: "USER TEXT",
  temperature: 0.2,
  maxOutputTokens: 900,
  signal: new AbortController().signal,
  ...over,
});

const okBody = (content: unknown, usage: unknown = { prompt_tokens: 120, completion_tokens: 45 }): string =>
  JSON.stringify({ model: "some-model-from-groq", choices: [{ message: { role: "assistant", content } }], usage });

interface Seen {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function fakeFetch(respond: () => Response | Promise<Response>): { fetchFn: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return respond();
  }) as typeof fetch;
  return { fetchFn, seen };
}

async function kindOf(p: Promise<unknown>): Promise<ProviderErrorKind | "no error"> {
  try {
    await p;
    return "no error";
  } catch (e) {
    if (e instanceof ProviderError) return e.kind;
    throw e;
  }
}

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", KEY);
  vi.stubEnv("GROQ_MODEL_QUALITY", "model-quality-x");
  vi.stubEnv("GROQ_MODEL_FAST", "model-fast-y");
});
afterEach(() => vi.unstubAllEnvs());

describe("createGroqProvider: request shape", () => {
  it("posts one chat completion to Groq with the key, the quality model and a JSON object response", async () => {
    const { fetchFn, seen } = fakeFetch(() => new Response(okBody('{"a":1}')));
    const res = await createGroqProvider({ fetchFn }).complete(call());
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toMatch(URL_RE);
    expect(seen[0].init.method).toBe("POST");
    const headers = new Headers(seen[0].init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(seen[0].body).toEqual({
      model: "model-quality-x",
      messages: [
        { role: "system", content: "SYSTEM TEXT" },
        { role: "user", content: "USER TEXT" },
      ],
      temperature: 0.2,
      max_completion_tokens: 900,
      response_format: { type: "json_object" },
      stream: false,
    });
    expect(res).toEqual({ text: '{"a":1}', modelUsed: "model-quality-x", inTokens: 120, outTokens: 45 });
  });

  it("sends a low reasoning effort only to a gpt-oss model (other models reject the parameter)", async () => {
    vi.stubEnv("GROQ_MODEL_QUALITY", "openai/gpt-oss-120b");
    vi.stubEnv("GROQ_MODEL_FAST", "llama-3.1-8b-instant");
    const { fetchFn, seen } = fakeFetch(() => new Response(okBody("{}")));
    const p = createGroqProvider({ fetchFn });
    await p.complete(call({ tier: "quality" }));
    await p.complete(call({ tier: "fast" }));
    expect(seen[0].body.reasoning_effort).toBe("low");
    expect(seen[1]).toBeDefined();
    expect("reasoning_effort" in seen[1].body).toBe(false);
  });

  it("uses the fast model for the fast tier and reports the configured name, never the name the server echoes", async () => {
    const { fetchFn, seen } = fakeFetch(() => new Response(okBody("{}")));
    const res = await createGroqProvider({ fetchFn }).complete(call({ tier: "fast", maxOutputTokens: 300 }));
    expect(seen[0].body.model).toBe("model-fast-y");
    expect(seen[0].body.max_completion_tokens).toBe(300);
    expect(res.modelUsed).toBe("model-fast-y");
  });

  it("passes the caller's abort signal to fetch", async () => {
    const { fetchFn, seen } = fakeFetch(() => new Response(okBody("{}")));
    const ac = new AbortController();
    await createGroqProvider({ fetchFn }).complete(call({ signal: ac.signal }));
    expect(seen[0].init.signal).toBe(ac.signal);
  });

  it("counts missing usage as zero tokens", async () => {
    const { fetchFn } = fakeFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] })));
    const res = await createGroqProvider({ fetchFn }).complete(call());
    expect([res.inTokens, res.outTokens]).toEqual([0, 0]);
  });
});

describe("createGroqProvider: failures", () => {
  it("throws ProviderError('config') before any request when the keys are missing", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const { fetchFn, seen } = fakeFetch(() => new Response(okBody("{}")));
    expect(await kindOf(createGroqProvider({ fetchFn }).complete(call()))).toBe("config");
    expect(seen).toHaveLength(0);
  });

  it("an empty, blank or missing content is 'empty'", async () => {
    for (const content of ["", "   \n", null, undefined]) {
      const { fetchFn } = fakeFetch(() => new Response(okBody(content)));
      expect(await kindOf(createGroqProvider({ fetchFn }).complete(call()))).toBe("empty");
    }
    for (const bad of ['{"choices":[]}', "not json", "[]", '{"choices":[{"message":{"content":5}}]}']) {
      const { fetchFn } = fakeFetch(() => new Response(bad));
      expect(await kindOf(createGroqProvider({ fetchFn }).complete(call()))).toBe("empty");
    }
  });

  it.each([400, 401, 429, 500, 503])("a %i answer is 'http'", async (status) => {
    const { fetchFn } = fakeFetch(() => new Response("{}", { status }));
    expect(await kindOf(createGroqProvider({ fetchFn }).complete(call()))).toBe("http");
  });

  it("a 400 that names an unsupported parameter is still just 'http', and none of its words reach the error", async () => {
    const body = JSON.stringify({ error: { message: "reasoning_effort is not supported with this model", type: "invalid_request_error" } });
    const { fetchFn } = fakeFetch(() => new Response(body, { status: 400 }));
    try {
      await createGroqProvider({ fetchFn }).complete(call());
      throw new Error("expected a ProviderError");
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).kind).toBe("http");
      expect(`${(e as Error).message}${JSON.stringify(e)}`).not.toContain("reasoning_effort");
    }
  });

  it("a network failure is 'http'", async () => {
    const fetchFn = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await kindOf(createGroqProvider({ fetchFn }).complete(call()))).toBe("http");
  });

  it("an abort while the request is in flight is 'timeout'", async () => {
    const ac = new AbortController();
    const fetchFn = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
        queueMicrotask(() => ac.abort());
      })) as typeof fetch;
    expect(await kindOf(createGroqProvider({ fetchFn }).complete(call({ signal: ac.signal })))).toBe("timeout");
  });

  it("a signal that is already aborted is 'aborted' and no request is made", async () => {
    const { fetchFn, seen } = fakeFetch(() => new Response(okBody("{}")));
    const ac = new AbortController();
    ac.abort();
    expect(await kindOf(createGroqProvider({ fetchFn }).complete(call({ signal: ac.signal })))).toBe("aborted");
    expect(seen).toHaveLength(0);
  });

  it("never puts the response body, the key or the prompt in an error message", async () => {
    const leak = "PROVIDER SAID: your key gsk_LEAKLEAKLEAKLEAKLEAKLEAK and USER TEXT";
    const cases: Array<() => Response> = [() => new Response(leak, { status: 500 }), () => new Response(okBody("")), () => new Response(leak)];
    for (const make of cases) {
      const { fetchFn } = fakeFetch(make);
      try {
        await createGroqProvider({ fetchFn }).complete(call());
        throw new Error("expected a ProviderError");
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        const text = `${(e as Error).message} ${String(e)} ${JSON.stringify(e)}`;
        for (const bad of ["PROVIDER SAID", "gsk_", KEY, "USER TEXT", "SYSTEM TEXT"]) expect(text).not.toContain(bad);
      }
    }
  });

  it("a thrown error from fetch does not leak its message either", async () => {
    const fetchFn = (async () => {
      throw new Error(`connect failed with ${KEY}`);
    }) as typeof fetch;
    try {
      await createGroqProvider({ fetchFn }).complete(call());
      throw new Error("expected a ProviderError");
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect(`${(e as Error).message}${JSON.stringify(e)}`).not.toContain(KEY);
    }
  });
});

describe("ProviderError", () => {
  it("carries only its kind", () => {
    const e = new ProviderError("http");
    expect(e.kind).toBe("http");
    expect(e.message).toBe("http");
    expect(e.name).toBe("ProviderError");
    expect(e).toBeInstanceOf(Error);
  });
});
