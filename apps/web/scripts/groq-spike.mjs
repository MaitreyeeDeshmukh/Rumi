// Provider spike for the [VERIFY] items in src/lib/ai/provider.ts. Run it ONCE with a real key, on synthetic text only:
//   GROQ_API_KEY=... GROQ_MODEL_QUALITY=openai/gpt-oss-120b GROQ_MODEL_FAST=openai/gpt-oss-20b node scripts/groq-spike.mjs
// It never reads .env files and never prints the key, a prompt or an answer. It prints only: status, retry-after, whether the
// answer parsed as the expected JSON, and token counts (prompt, cached, completion). Nothing is written to disk.
// What it settles:
//   1. Does Groq accept a strict json_schema request for each model (status 200, not 400)?
//   2. Does the answer parse as the schema, with reasoning_effort low and each task's token cap?
//   3. How many completion tokens go to reasoning (completion_tokens versus the length of the JSON answer)?
//   4. Does a second identical call report cached tokens (prompt_tokens_details.cached_tokens)?
const key = process.env.GROQ_API_KEY;
const models = { quality: process.env.GROQ_MODEL_QUALITY, fast: process.env.GROQ_MODEL_FAST };
if (!key || !models.quality || !models.fast) {
  console.error("Set GROQ_API_KEY, GROQ_MODEL_QUALITY and GROQ_MODEL_FAST in the environment.");
  process.exit(1);
}

const schema = {
  type: "object",
  properties: { clinicianSay: { type: "string" }, coveredItemIds: { type: "array", items: { type: "string" } }, isLastTurn: { type: "boolean" }, crisis: { type: "boolean" } },
  required: ["clinicianSay", "coveredItemIds", "isLastTurn", "crisis"],
  additionalProperties: false,
};
// A long, byte-stable prefix, so a second call can show prompt caching.
const system = `You are a practice clinician in a made-up practice visit. ${"Ask one short question per turn. ".repeat(60)}Return JSON only.`;
const user = "The person said: I keep getting headaches. Ask one question.";

async function call(label, model, strict, maxTokens) {
  const started = Date.now();
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.2,
      max_completion_tokens: maxTokens,
      response_format: strict ? { type: "json_schema", json_schema: { name: "practice_reply", strict: true, schema } } : { type: "json_object" },
      reasoning_effort: "low",
      stream: false,
    }),
  });
  const line = { label, status: res.status, retryAfter: res.headers.get("retry-after"), ms: Date.now() - started };
  if (!res.ok) {
    await res.body?.cancel();
    console.log(JSON.stringify(line));
    return;
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  let parsed = false;
  try {
    const o = JSON.parse(text);
    parsed = typeof o.clinicianSay === "string" && Array.isArray(o.coveredItemIds) && typeof o.isLastTurn === "boolean" && typeof o.crisis === "boolean";
  } catch {
    parsed = false;
  }
  console.log(
    JSON.stringify({
      ...line,
      parsedAsSchema: parsed,
      answerChars: text.length,
      finish: data?.choices?.[0]?.finish_reason,
      promptTokens: data?.usage?.prompt_tokens,
      cachedTokens: data?.usage?.prompt_tokens_details?.cached_tokens ?? null,
      completionTokens: data?.usage?.completion_tokens,
    }),
  );
}

for (const [tier, model] of Object.entries(models)) {
  await call(`${tier} strict, cap 900`, model, true, 900);
  await call(`${tier} strict again (look for cachedTokens)`, model, true, 900);
  await call(`${tier} json_object, cap 900`, model, false, 900);
  await call(`${tier} strict, cap 200 (does reasoning cut the JSON off?)`, model, true, 200);
}
