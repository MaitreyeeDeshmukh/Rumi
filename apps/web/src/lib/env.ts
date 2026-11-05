import { z } from "zod";

/**
 * The only module that reads process.env. Nothing here runs at import time, and nothing parses the whole
 * environment on a request path: each feature reads only its own variables (`getSessionSecret`, `getGroqConfig`,
 * `getLimits`, `mockAiEnabled`). A typo in an unrelated variable (MOCK_AI="true", AI_DAILY_USER_LIMIT=abc) therefore
 * cannot take down the crisis check or any other path. `parseEnv` and `invalidEnvNames` still validate everything,
 * for the P7 gate and a startup log line.
 * Variable names match .env.example.
 */
const secret = z.string().trim().min(32);
const flag = z.enum(["1", "0"]);
const nonEmpty = z.string().trim().min(1);

const schema = z.object({
  NODE_ENV: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: nonEmpty.optional(),
  GROQ_API_KEY: nonEmpty.optional(),
  GROQ_MODEL_QUALITY: nonEmpty.optional(),
  GROQ_MODEL_FAST: nonEmpty.optional(),
  GROQ_MODEL_STT: nonEmpty.optional(),
  SESSION_SECRET: secret.optional(),
  MEMORY_TAG_SECRET: secret.optional(),
  SUPERMEMORY_API_KEY: nonEmpty.optional(),
  MEMORY_ENABLED: flag.optional(),
  CARTESIA_API_KEY: nonEmpty.optional(),
  CARTESIA_VERSION: nonEmpty.optional(),
  SENTRY_DSN: nonEmpty.optional(),
  AI_DAILY_USER_LIMIT: z.coerce.number().int().positive().optional(),
  AI_DAILY_GLOBAL_SPEND_CAP_USD: z.coerce.number().positive().optional(),
  MOCK_AI: flag.optional(),
  EVAL_MODE: flag.optional(),
});

export type Env = z.infer<typeof schema>;

/** A configuration problem. The message is a fixed string; only variable names are carried, never values. */
export class ConfigError extends Error {
  constructor(readonly names: readonly string[]) {
    super("configuration error");
    this.name = "ConfigError";
  }
}

const cleaned = (source: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(source).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== ""));

/** Throws an Error that names the bad variables and never echoes a value. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(cleaned(source));
  if (!result.success) {
    const names = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return result.data;
}

/** Names of the variables that fail validation. Never throws, never returns a value. */
export function invalidEnvNames(source: Record<string, string | undefined> = process.env): string[] {
  const result = schema.safeParse(cleaned(source));
  return result.success ? [] : [...new Set(result.error.issues.map((i) => String(i.path[0])))];
}

/** MOCK_AI is on only for the exact value "1". Any other value, including a typo, is off and breaks nothing. */
export const mockAiEnabled = (): boolean => process.env.MOCK_AI === "1";

/** EVAL_MODE relaxes limits and is ignored in production. */
export const evalModeEnabled = (): boolean => process.env.EVAL_MODE === "1" && process.env.NODE_ENV !== "production";

export const isProduction = (): boolean => process.env.NODE_ENV === "production";

/** undefined when unset; throws ConfigError("SESSION_SECRET") when set but shorter than 32 characters after trimming. */
export function getSessionSecret(): string | undefined {
  const raw = process.env.SESSION_SECRET;
  if (raw === undefined || raw === "") return undefined;
  const parsed = secret.safeParse(raw);
  if (!parsed.success) throw new ConfigError(["SESSION_SECRET"]);
  return parsed.data;
}

export interface GroqConfig {
  apiKey: string;
  modelQuality: string;
  modelFast: string;
}

/** Throws ConfigError listing the missing or invalid names. */
export function getGroqConfig(): GroqConfig {
  const take = (name: string): string | undefined => {
    const v = nonEmpty.safeParse(process.env[name]);
    return v.success ? v.data : undefined;
  };
  const apiKey = take("GROQ_API_KEY");
  const modelQuality = take("GROQ_MODEL_QUALITY");
  const modelFast = take("GROQ_MODEL_FAST");
  const missing = [apiKey ? "" : "GROQ_API_KEY", modelQuality ? "" : "GROQ_MODEL_QUALITY", modelFast ? "" : "GROQ_MODEL_FAST"].filter(Boolean);
  if (!apiKey || !modelQuality || !modelFast) throw new ConfigError(missing);
  return { apiKey, modelQuality, modelFast };
}

export interface UsageLimits {
  dailyUserLimit: number | undefined;
  dailyGlobalSpendCapUsd: number | undefined;
}

/** A bad value is treated as unset for that one limit; the names of bad variables come from invalidEnvNames. */
export function getLimits(): UsageLimits {
  const user = z.coerce.number().int().positive().safeParse(process.env.AI_DAILY_USER_LIMIT);
  const spend = z.coerce.number().positive().safeParse(process.env.AI_DAILY_GLOBAL_SPEND_CAP_USD);
  return {
    dailyUserLimit: user.success ? user.data : undefined,
    dailyGlobalSpendCapUsd: spend.success ? spend.data : undefined,
  };
}

/**
 * What a live AI request needs. Throws ConfigError listing missing variable names only.
 * SESSION_SECRET is required in production even with MOCK_AI=1: the development secret is public.
 */
export function assertRuntimeEnv(): void {
  const missing: string[] = [];
  let secretOk = false;
  try {
    secretOk = getSessionSecret() !== undefined;
  } catch {
    // A secret that is set but too short counts as missing here; the name is what matters.
    secretOk = false;
  }
  if (mockAiEnabled()) {
    if (isProduction() && !secretOk) missing.push("SESSION_SECRET");
  } else {
    try {
      getGroqConfig();
    } catch (e) {
      if (e instanceof ConfigError) missing.push(...e.names);
    }
    if (!secretOk) missing.push("SESSION_SECRET");
  }
  if (missing.length > 0) throw new ConfigError(missing);
}
