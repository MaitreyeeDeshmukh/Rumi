/**
 * The only file that knows the AI vendor (Groq, OpenAI-compatible chat completions, plain fetch, no package).
 * Every failure is a `ProviderError` with a kind and a fixed message: nothing the server answered, no key and no
 * prompt text can end up in an error, a log line or a reply. A response body is never read on an error status.
 *
 * `modelUsed` is always the configured model name (GROQ_MODEL_*), never a string the server sent back.
 *
 * Output mode: strict JSON schema first (`response_format.type = json_schema`, `strict: true`), then JSON-object mode
 * for the rest of this instance's life if Groq answers 400 to a strict request. Our own Zod check runs in both modes.
 * Verified in Groq's live docs on 2026-11-05: gpt-oss-20b and gpt-oss-120b are on the strict-mode list; every property must
 * be required and every object closed; the 429 `retry-after` header is in seconds; cached tokens come back in
 * `usage.prompt_tokens_details.cached_tokens`. [VERIFY] with a live request (scripts/groq-spike.mjs): that Groq accepts the
 * schema `toStrictJsonSchema` produces, and how many reasoning tokens gpt-oss spends inside `max_completion_tokens`.
 */
import { z } from "zod";
import type { Tier } from "@/features/shared/task";
import { ConfigError, getGroqConfig } from "@/lib/env";

export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

export interface ProviderCall {
  tier: Tier;
  system: string;
  user: string;
  temperature: number;
  maxOutputTokens: number;
  signal: AbortSignal;
  /** Strict mode is tried when this is set. Absent means JSON-object mode only. */
  jsonSchema?: JsonSchemaSpec;
}

export interface ProviderResult {
  text: string;
  modelUsed: string;
  inTokens: number;
  outTokens: number;
  /** Prompt tokens served from Groq's prompt cache (a subset of inTokens). 0 when the field is absent. */
  cachedTokens?: number;
}

/**
 * timeout: no answer in time. http: network failure, 5xx or 408. rate_limited: 429. rejected: any other 4xx (never retried).
 * config: keys missing. empty: 2xx without usable text. aborted: the caller's signal was already aborted.
 */
export type ProviderErrorKind = "timeout" | "http" | "rate_limited" | "rejected" | "config" | "empty" | "aborted";

export class ProviderError extends Error {
  /** Seconds from a 429 Retry-After header, whole and between 0 and 3600. undefined when the header is absent or unreadable. */
  readonly retryAfterSec?: number;
  readonly status?: number;
  constructor(
    readonly kind: ProviderErrorKind,
    detail: { status?: number; retryAfterSec?: number } = {},
  ) {
    super(kind);
    this.name = "ProviderError";
    this.status = detail.status;
    this.retryAfterSec = detail.retryAfterSec;
  }
}

export interface Provider {
  complete(call: ProviderCall): Promise<ProviderResult>;
  /** The configured model name for a tier. Part of every cache key, so a model change never serves an old answer. */
  model(tier: Tier): string;
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const Completion = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullish() }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      prompt_tokens_details: z.object({ cached_tokens: z.number().optional() }).nullish(),
    })
    .optional(),
});

const tokens = (n: number | undefined): number => (n !== undefined && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/** Retry-After in whole seconds. A date form or garbage gives undefined (the caller then uses its own short default). */
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\s*\d{1,6}(?:\.\d+)?\s*$/.test(value)) return undefined;
  return Math.min(3600, Math.ceil(Number(value)));
}

// ---------------------------------------------------------------- strict JSON schema (07 D23)

type Json = Record<string, unknown>;
const isJson = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Keywords strict mode may reject. Zod enforces them after the answer arrives, so nothing is lost by leaving them out. */
const DROP = ["$schema", "minLength", "maxLength", "pattern", "format", "minItems", "maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "default"];

function strictNode(node: unknown, optional: boolean): unknown {
  if (!isJson(node)) return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node)) if (!DROP.includes(k)) out[k] = v;

  if (isJson(out.properties)) {
    const required = new Set(Array.isArray(out.required) ? (out.required as string[]) : []);
    const props: Json = {};
    for (const [name, child] of Object.entries(out.properties)) props[name] = strictNode(child, !required.has(name));
    out.properties = props;
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  if (isJson(out.items)) out.items = strictNode(out.items, false);
  if (Array.isArray(out.anyOf)) out.anyOf = out.anyOf.map((n) => strictNode(n, false));

  if (!optional) return out;
  // An optional field becomes required but nullable.
  if (typeof out.type === "string") return { ...out, type: [out.type, "null"] };
  return { anyOf: [out, { type: "null" }] };
}

/** Zod schema -> the JSON schema strict mode accepts: all properties required, objects closed, optionals nullable. */
export function toStrictJsonSchema(schema: z.ZodType): Json {
  return strictNode(z.toJSONSchema(schema), false) as Json;
}

// ---------------------------------------------------------------- the Groq provider

/**
 * `fetchFn` is for tests. A 400 to a strict request is answered once with the same request in JSON-object mode, and that
 * model stays in JSON-object mode for the life of this provider (the harness still counts it as one call).
 */
export function createGroqProvider(deps: { fetchFn?: typeof fetch } = {}): Provider {
  const strictRefused = new Set<string>();

  async function post(config: ReturnType<typeof getGroqConfig>, model: string, call: ProviderCall, strict: boolean): Promise<Response> {
    const format = strict && call.jsonSchema !== undefined
      ? { type: "json_schema", json_schema: { name: call.jsonSchema.name, strict: true, schema: call.jsonSchema.schema } }
      : { type: "json_object" };
    try {
      return await (deps.fetchFn ?? fetch)(GROQ_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: call.system },
            { role: "user", content: call.user },
          ],
          temperature: call.temperature,
          max_completion_tokens: call.maxOutputTokens,
          response_format: format,
          reasoning_effort: "low",
          stream: false,
        }),
        signal: call.signal,
        cache: "no-store",
      });
    } catch {
      // The inner error can carry the URL or headers. Only whether we were aborted matters.
      throw new ProviderError(call.signal.aborted ? "timeout" : "http");
    }
  }

  const modelFor = (config: ReturnType<typeof getGroqConfig>, tier: Tier): string => (tier === "quality" ? config.modelQuality : config.modelFast);

  return {
    model(tier: Tier): string {
      try {
        return modelFor(getGroqConfig(), tier);
      } catch (e) {
        if (e instanceof ConfigError) throw new ProviderError("config");
        throw e;
      }
    },

    async complete(call: ProviderCall): Promise<ProviderResult> {
      let config: ReturnType<typeof getGroqConfig>;
      try {
        config = getGroqConfig();
      } catch (e) {
        if (e instanceof ConfigError) throw new ProviderError("config");
        throw e;
      }
      if (call.signal.aborted) throw new ProviderError("aborted");

      const model = modelFor(config, call.tier);
      let strict = call.jsonSchema !== undefined && !strictRefused.has(model);
      let res = await post(config, model, call, strict);
      if (strict && res.status === 400) {
        await res.body?.cancel().catch(() => undefined);
        strictRefused.add(model);
        strict = false;
        res = await post(config, model, call, false);
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined); // the body is never read, so it can never be copied anywhere
        if (res.status === 429) throw new ProviderError("rate_limited", { status: 429, retryAfterSec: parseRetryAfter(res.headers.get("retry-after")) });
        if (res.status >= 500 || res.status === 408) throw new ProviderError("http", { status: res.status });
        throw new ProviderError("rejected", { status: res.status });
      }

      let data: unknown;
      try {
        data = await res.json();
      } catch {
        // An aborted read is a timeout; anything else is a 2xx answer that is not JSON.
        throw new ProviderError(call.signal.aborted ? "timeout" : "empty");
      }
      const parsed = Completion.safeParse(data);
      const text = parsed.success ? parsed.data.choices[0].message.content : undefined;
      if (!parsed.success || typeof text !== "string" || text.trim() === "") throw new ProviderError("empty");
      return {
        text,
        modelUsed: model,
        inTokens: tokens(parsed.data.usage?.prompt_tokens),
        outTokens: tokens(parsed.data.usage?.completion_tokens),
        cachedTokens: tokens(parsed.data.usage?.prompt_tokens_details?.cached_tokens),
      };
    },
  };
}
