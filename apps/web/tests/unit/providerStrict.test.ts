import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PlanModelOut, PracticeModelOut, RecapModelOut, SayItModelOut } from "@/features/shared/schemas";
import { ProviderError, createGroqProvider, toStrictJsonSchema, type ProviderCall, type ProviderErrorKind } from "@/lib/ai/provider";

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
  JSON.stringify({ choices: [{ message: { role: "assistant", content } }], usage });

function fakeFetch(respond: (n: number) => Response): { fetchFn: typeof fetch; formats: string[] } {
  const formats: string[] = [];
  const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    formats.push((JSON.parse(String(init?.body)) as { response_format: { type: string } }).response_format.type);
    return respond(formats.length);
  }) as typeof fetch;
  return { fetchFn, formats };
}

async function failure(p: Promise<unknown>): Promise<ProviderError> {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  if (!(e instanceof ProviderError)) throw new Error("expected a ProviderError");
  return e;
}

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", KEY);
  vi.stubEnv("GROQ_MODEL_QUALITY", "model-quality-x");
  vi.stubEnv("GROQ_MODEL_FAST", "model-fast-y");
});
afterEach(() => vi.unstubAllEnvs());

describe("createGroqProvider: 429 and Retry-After", () => {
  it("a 429 is 'rate_limited' and carries the Retry-After seconds", async () => {
    const { fetchFn } = fakeFetch(() => new Response("{}", { status: 429, headers: { "retry-after": "7" } }));
    expect(await failure(createGroqProvider({ fetchFn }).complete(call()))).toMatchObject({ kind: "rate_limited", status: 429, retryAfterSec: 7 });
  });

  it.each([undefined, "soon", "Wed, 21 Oct 2026 07:28:00 GMT", "-5"])("a 429 whose Retry-After is %s has no retryAfterSec", async (header) => {
    const { fetchFn } = fakeFetch(() => new Response("{}", { status: 429, headers: header === undefined ? {} : { "retry-after": header } }));
    const e = await failure(createGroqProvider({ fetchFn }).complete(call()));
    expect(e.kind).toBe("rate_limited");
    expect(e.retryAfterSec).toBeUndefined();
  });

  it.each([["2", 2], ["1.2", 2], ["999999", 3600]])("Retry-After %s becomes %i whole seconds, never more than an hour", async (header, seconds) => {
    const { fetchFn } = fakeFetch(() => new Response("{}", { status: 429, headers: { "retry-after": header } }));
    expect((await failure(createGroqProvider({ fetchFn }).complete(call()))).retryAfterSec).toBe(seconds);
  });

  it("an error never carries the answer body or the key", async () => {
    const { fetchFn } = fakeFetch(() => new Response(`secret ${KEY}`, { status: 429 }));
    const e = await failure(createGroqProvider({ fetchFn }).complete(call()));
    const shown = JSON.stringify([e.message, e.kind, e.status, e.retryAfterSec]);
    expect(shown).not.toContain("secret");
    expect(shown).not.toContain(KEY);
  });

  it("5xx and 408 are 'http'; every other 4xx is 'rejected' after exactly one request", async () => {
    const kinds: Record<number, ProviderErrorKind> = { 500: "http", 503: "http", 408: "http", 400: "rejected", 401: "rejected", 404: "rejected" };
    for (const [status, kind] of Object.entries(kinds)) {
      const { fetchFn, formats } = fakeFetch(() => new Response("{}", { status: Number(status) }));
      expect((await failure(createGroqProvider({ fetchFn }).complete(call()))).kind).toBe(kind);
      expect(formats).toHaveLength(1);
    }
  });
});

describe("createGroqProvider: strict JSON schema and the JSON-object fallback", () => {
  const jsonSchema = { name: "x_reply", schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false } };

  it("sends response_format json_schema with strict:true when the call has a schema", async () => {
    let body: { response_format?: unknown } = {};
    const fetchFn = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as typeof body;
      return new Response(okBody('{"a":"b"}'));
    }) as typeof fetch;
    await createGroqProvider({ fetchFn }).complete(call({ jsonSchema }));
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "x_reply", strict: true, schema: jsonSchema.schema } });
  });

  it("without a schema the request is JSON-object mode", async () => {
    const { fetchFn, formats } = fakeFetch(() => new Response(okBody("{}")));
    await createGroqProvider({ fetchFn }).complete(call());
    expect(formats).toEqual(["json_object"]);
  });

  it("a 400 to a strict request is answered once in JSON-object mode, and that model stays there", async () => {
    const { fetchFn, formats } = fakeFetch((n) => (n === 1 ? new Response("{}", { status: 400 }) : new Response(okBody('{"a":"b"}'))));
    const p = createGroqProvider({ fetchFn });
    expect((await p.complete(call({ jsonSchema }))).text).toBe('{"a":"b"}');
    await p.complete(call({ jsonSchema }));
    expect(formats).toEqual(["json_schema", "json_object", "json_object"]);
  });

  it("a strict 400 followed by another 400 is 'rejected' after two requests, never more", async () => {
    const { fetchFn, formats } = fakeFetch(() => new Response("{}", { status: 400 }));
    expect((await failure(createGroqProvider({ fetchFn }).complete(call({ jsonSchema })))).kind).toBe("rejected");
    expect(formats).toHaveLength(2);
  });

  it("the other model is still tried in strict mode after one model was refused", async () => {
    const { fetchFn, formats } = fakeFetch((n) => (n === 1 ? new Response("{}", { status: 400 }) : new Response(okBody("{}"))));
    const p = createGroqProvider({ fetchFn });
    await p.complete(call({ jsonSchema, tier: "quality" }));
    await p.complete(call({ jsonSchema, tier: "fast" }));
    expect(formats[2]).toBe("json_schema");
  });

  it("reads cached tokens from usage.prompt_tokens_details", async () => {
    const { fetchFn } = fakeFetch(() => new Response(okBody("{}", { prompt_tokens: 200, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 128 } })));
    expect((await createGroqProvider({ fetchFn }).complete(call())).cachedTokens).toBe(128);
  });

  it("model(tier) is the configured name, and 'config' when the name is missing", () => {
    const p = createGroqProvider();
    expect([p.model("quality"), p.model("fast")]).toEqual(["model-quality-x", "model-fast-y"]);
    vi.stubEnv("GROQ_MODEL_FAST", "");
    expect(() => p.model("fast")).toThrow(ProviderError);
  });
});

describe("toStrictJsonSchema (07 D23)", () => {
  type Node = { properties?: Record<string, Node>; required?: string[]; additionalProperties?: boolean; items?: Node; type?: string | string[]; anyOf?: Node[] };

  function closed(n: Node): boolean {
    const here = n.properties === undefined || (n.additionalProperties === false && JSON.stringify(n.required) === JSON.stringify(Object.keys(n.properties)));
    return here && Object.values(n.properties ?? {}).every(closed) && (n.items === undefined || closed(n.items)) && (n.anyOf ?? []).every(closed);
  }

  it.each([
    ["plan", PlanModelOut],
    ["practice", PracticeModelOut],
    ["sayit", SayItModelOut],
    ["recap", RecapModelOut],
  ])("makes the %s model output strict: every property required, every object closed, no $schema", (_name, schema) => {
    const out = toStrictJsonSchema(schema) as Node & { $schema?: string };
    expect(out.$schema).toBeUndefined();
    expect(closed(out)).toBe(true);
  });

  it("turns an optional field into a required nullable one, at any depth", () => {
    const out = toStrictJsonSchema(z.object({ a: z.string(), b: z.string().optional(), c: z.array(z.object({ d: z.number().optional() })) })) as Node;
    expect(out.required).toEqual(["a", "b", "c"]);
    expect(out.properties?.a.type).toBe("string");
    expect(out.properties?.b.type).toEqual(["string", "null"]);
    expect(out.properties?.c.items?.properties?.d.type).toEqual(["number", "null"]);
    expect(out.additionalProperties).toBe(false);
  });

  it("leaves out length and size keywords that strict mode may refuse (Zod still enforces them)", () => {
    const text = JSON.stringify(toStrictJsonSchema(z.object({ a: z.string().min(1).max(5), b: z.array(z.string()).max(3) })));
    for (const key of ["minLength", "maxLength", "maxItems", "minItems", "pattern"]) expect(text).not.toContain(key);
  });
});
