/**
 * What a provider call costs, in millionths of a US dollar. One USD per million tokens is exactly one micro-dollar per
 * token, so the table below is also the micro-dollar price of one token. Used for the `costMicroUsd` telemetry field
 * (and later the daily spend cap, Phase 5). It is an estimate from list prices: it ignores cached-input discounts.
 *
 * Source: https://console.groq.com/docs/models (Groq's own model table), read on 2026-11-05:
 *   openai/gpt-oss-120b  $0.15 input / $0.60 output per 1M tokens
 *   openai/gpt-oss-20b   $0.075 input / $0.30 output per 1M tokens
 *   whisper-large-v3-turbo is billed per audio hour ($0.04 per hour on the same page), not per token, so it is not here
 *   (speech to text is Phase 6; add an hourly price then).
 * https://groq.com/pricing did not show prices to a plain page fetch on that date, so the console table is the only source.
 * Keep in step with DEFAULT_PRICES in tests/evals/scorers/aggregate.ts (that file cannot import src; a test compares them).
 */
export const PRICES_PER_MTOK_USD: Readonly<Record<string, { in: number; out: number }>> = {
  "openai/gpt-oss-120b": { in: 0.15, out: 0.6 },
  "openai/gpt-oss-20b": { in: 0.075, out: 0.3 },
};

const count = (n: number): number => (Number.isFinite(n) ? Math.max(0, n) : 0);

/** 0 for a model that has no price here (a new model id): the telemetry then shows tokens but no cost, never NaN. */
export function estimateCostMicroUsd(model: string, inTokens: number, outTokens: number): number {
  const price = Object.hasOwn(PRICES_PER_MTOK_USD, model) ? PRICES_PER_MTOK_USD[model] : undefined;
  if (price === undefined) return 0;
  // Rounded up per call so that a real call is never recorded as free.
  return Math.max(0, Math.ceil(count(inTokens) * price.in + count(outTokens) * price.out - 1e-9));
}
