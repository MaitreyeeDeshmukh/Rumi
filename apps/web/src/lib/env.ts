import { z } from "zod";

/**
 * The only module that reads process.env. Nothing here runs at import time: `getEnv()` parses on first
 * use and memoises a valid result, so builds, CI and Playwright stay green with an empty environment.
 * Variable names match .env.example.
 */
const secret = z.string().min(32);
const flag = z.enum(["1", "0"]);

const schema = z.object({
  NODE_ENV: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  GROQ_API_KEY: z.string().min(1).optional(),
  GROQ_MODEL_QUALITY: z.string().min(1).optional(),
  GROQ_MODEL_FAST: z.string().min(1).optional(),
  GROQ_MODEL_STT: z.string().min(1).optional(),
  SESSION_SECRET: secret.optional(),
  MEMORY_TAG_SECRET: secret.optional(),
  SUPERMEMORY_API_KEY: z.string().min(1).optional(),
  MEMORY_ENABLED: flag.optional(),
  CARTESIA_API_KEY: z.string().min(1).optional(),
  CARTESIA_VERSION: z.string().min(1).optional(),
  SENTRY_DSN: z.string().min(1).optional(),
  AI_DAILY_USER_LIMIT: z.coerce.number().int().positive().optional(),
  AI_DAILY_GLOBAL_SPEND_CAP_USD: z.coerce.number().positive().optional(),
  MOCK_AI: flag.optional(),
  EVAL_MODE: flag.optional(),
});

export type Env = z.infer<typeof schema>;

/** Throws an Error that names the bad variables and never echoes a value. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const names = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Lazy and memoised. A failure is not cached, so a fixed configuration is picked up on the next call. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/**
 * What a live (non-mock) AI request needs. Throws an Error that lists missing variable names only.
 * The caller turns the throw into a degraded reply and a logged config error, never a crash.
 */
export function assertRuntimeEnv(): void {
  const env = getEnv();
  if (env.MOCK_AI === "1") return;
  const required = ["GROQ_API_KEY", "GROQ_MODEL_QUALITY", "GROQ_MODEL_FAST", "SESSION_SECRET"] as const;
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Missing configuration: ${missing.join(", ")}`);
}
