/**
 * The only file that knows the AI vendor (Groq, OpenAI-compatible chat completions, plain fetch, no package).
 * Every failure is a `ProviderError` with a kind and a fixed message: nothing the server answered, no key and no
 * prompt text can end up in an error, a log line or a reply.
 *
 * `modelUsed` is always the configured model name (GROQ_MODEL_*), never a string the server sent back.
 * Not verified live yet (Phase 3): the strict JSON-schema mode, token prices and reasoning-token use. JSON object
 * mode plus our own Zod check is what runs.
 */
import { z } from "zod";
import type { Tier } from "@/features/shared/task";
import { ConfigError, getGroqConfig } from "@/lib/env";

export interface ProviderCall {
  tier: Tier;
  system: string;
  user: string;
  temperature: number;
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface ProviderResult {
  text: string;
  modelUsed: string;
  inTokens: number;
  outTokens: number;
}

export type ProviderErrorKind = "timeout" | "http" | "config" | "empty" | "aborted";

export class ProviderError extends Error {
  constructor(readonly kind: ProviderErrorKind) {
    super(kind);
    this.name = "ProviderError";
  }
}

export interface Provider {
  complete(call: ProviderCall): Promise<ProviderResult>;
}

/** The reasoning effort sent to the gpt-oss models. The eval pins the baseline arm to this same value (tests/evals/live.ts). */
export const REASONING_EFFORT = "low";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const Completion = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullish() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).optional(),
});

const tokens = (n: number | undefined): number => (n !== undefined && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/**
 * `fetchFn` is for tests. Kinds: 'config' when the keys are missing (no request is made), 'aborted' when the caller's
 * signal was already aborted, 'timeout' when it aborts while the request is in flight, 'http' for a network failure or
 * any answer that is not 2xx, 'empty' for a 2xx answer with no usable text.
 */
export function createGroqProvider(deps: { fetchFn?: typeof fetch } = {}): Provider {
  return {
    async complete(call: ProviderCall): Promise<ProviderResult> {
      let config: ReturnType<typeof getGroqConfig>;
      try {
        config = getGroqConfig();
      } catch (e) {
        if (e instanceof ConfigError) throw new ProviderError("config");
        throw e;
      }
      if (call.signal.aborted) throw new ProviderError("aborted");

      const model = call.tier === "quality" ? config.modelQuality : config.modelFast;
      let res: Response;
      try {
        res = await (deps.fetchFn ?? fetch)(GROQ_URL, {
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
            response_format: { type: "json_object" },
            // Only the gpt-oss models take this parameter; any other model answers 400 to it.
            ...(model.toLowerCase().includes("gpt-oss") ? { reasoning_effort: REASONING_EFFORT } : {}),
            stream: false,
          }),
          signal: call.signal,
          cache: "no-store",
        });
      } catch {
        // The inner error can carry the URL or headers. Only whether we were aborted matters.
        throw new ProviderError(call.signal.aborted ? "timeout" : "http");
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined); // the body is never read, so it can never be copied anywhere
        throw new ProviderError("http");
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
      return { text, modelUsed: model, inTokens: tokens(parsed.data.usage?.prompt_tokens), outTokens: tokens(parsed.data.usage?.completion_tokens) };
    },
  };
}
