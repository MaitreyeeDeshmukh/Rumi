import { z } from "zod";

/**
 * The home of the application's settings. Almost every variable is read here, but not every one. The allowed exceptions
 * (each is a small, named read next to the code that needs it, never a second parser):
 *  - lib/supabase/config.ts: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (Next inlines `NEXT_PUBLIC_*` only when
 *    written as a literal `process.env.NAME`, so the browser bundle cannot go through this module) and AUTH_PROXY_REFRESH.
 *  - lib/supabase/admin.ts: the Supabase secret key (its variable name is written only in that file, on purpose, and is not
 *    in the schema below: tests/unit/authBundle.test.ts pins that exactly one source file names it, so it cannot reach a
 *    bundle or a validation message, and this comment must not spell it out).
 *    A missing key is reported by name through adminConfigProblems() and missingEnvNames() in lib/telemetry/config.ts.
 *  - lib/telemetry/config.ts: READY_TOKEN (compared in constant time), RELEASE and the Vercel build ids, TELEMETRY_DB_WRITES,
 *    SENTRY_DSN presence. Names only are ever reported.
 *  - lib/security/rateLimit.ts: VERCEL (whether the platform's address headers can be trusted). instrumentation.ts: NEXT_RUNTIME.
 * EVAL_CANARY is read here, by getEvalCanary(), and is deliberately not in the schema: it is an optional override, accepted
 * only as 8 to 64 letters, digits, underscores or hyphens (anything else falls back to the built-in marker), so a bad value
 * can never fail validation or reach a prompt. It applies in EVAL_MODE only, never in production.
 * The Turnstile, Cartesia and speech-to-text variables stay in the schema, so a malformed value is reported by name.
 * Nothing here runs at import time, and nothing parses the whole
 * environment on a request path: each feature reads only its own variables (`getSessionSecret`, `getGroqConfig`,
 * `getLimits`, `mockAiEnabled`). A typo in an unrelated variable (MOCK_AI="true", AI_DAILY_USER_LIMIT=abc) therefore
 * cannot take down the crisis check or any other path. `parseEnv` and `invalidEnvNames` still validate everything,
 * for the P7 gate and a startup log line.
 * Variable names match .env.example.
 */
const secret = z.string().trim().min(32);
const flag = z.enum(["1", "0"]);
const nonEmpty = z.string().trim().min(1);

/** The Cartesia-Version this code was written against (docs.cartesia.ai/api-reference/tts/bytes, checked 2026-11-05: the only allowed value). */
const CARTESIA_DEFAULT_VERSION = "2026-08-14";

const schema = z.object({
  NODE_ENV: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: nonEmpty.optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: nonEmpty.optional(),
  /** Public address on /contact. The contact page fails the production build without it. */
  NEXT_PUBLIC_CONTACT_EMAIL: z.string().email().optional(),
  GROQ_API_KEY: nonEmpty.optional(),
  GROQ_MODEL_QUALITY: nonEmpty.optional(),
  GROQ_MODEL_FAST: nonEmpty.optional(),
  GROQ_MODEL_STT: nonEmpty.optional(),
  SESSION_SECRET: secret.optional(),
  CARTESIA_API_KEY: nonEmpty.optional(),
  CARTESIA_VERSION: nonEmpty.optional(),
  SENTRY_DSN: nonEmpty.optional(),
  AI_DAILY_USER_LIMIT: z.coerce.number().int().positive().optional(),
  AI_DAILY_GLOBAL_SPEND_CAP_USD: z.coerce.number().positive().optional(),
  AI_DAILY_ANON_LIMIT: z.coerce.number().int().positive().optional(),
  AI_FORCE_OFF: flag.optional(),
  ALLOW_MOCK_IN_PROD: flag.optional(),
  VERCEL_ENV: z.string().min(1).optional(),
  MOCK_AI: flag.optional(),
  EVAL_MODE: flag.optional(),
  READY_TOKEN: nonEmpty.optional(),
  RELEASE: nonEmpty.optional(),
  TELEMETRY_DB_WRITES: nonEmpty.optional(),
  AUTH_PROXY_REFRESH: nonEmpty.optional(),
  TURNSTILE_SECRET_KEY: nonEmpty.optional(),
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

/** True on a Vercel production deployment. */
export const isVercelProduction = (): boolean => process.env.VERCEL_ENV === "production";

/**
 * MOCK_AI is on only for the exact value "1". Any other value, including a typo, is off and breaks nothing.
 * On a Vercel production deployment it is off whatever the variable says, unless ALLOW_MOCK_IN_PROD=1 is also set:
 * a leftover MOCK_AI=1 must never serve canned answers to real users.
 */
export const mockAiEnabled = (): boolean => process.env.MOCK_AI === "1" && (!isVercelProduction() || process.env.ALLOW_MOCK_IN_PROD === "1");

/** Mock answers outside a plain local run (any Vercel deployment, or NODE_ENV=production). Such answers carry x-rumi-mock and raise an app event. */
export const mockOutsideLocalDev = (): boolean => mockAiEnabled() && ((process.env.VERCEL_ENV ?? "") !== "" || isProduction());

/** AI_FORCE_OFF=1 behaves like ai_enabled=false and does not need Supabase: the kill-switch that still works when the database is down. */
export const aiForceOff = (): boolean => process.env.AI_FORCE_OFF === "1";

/** EVAL_MODE relaxes limits and is ignored in production. */
export const evalModeEnabled = (): boolean => process.env.EVAL_MODE === "1" && process.env.NODE_ENV !== "production";

export const isProduction = (): boolean => process.env.NODE_ENV === "production";

/** Same default as the evals scorer (tests/evals/scorers/leak.ts), which cannot be imported from src. */
const DEFAULT_CANARY = "RUMI-CANARY-7f3a91c2";

/**
 * The prompt-leak marker. Only in EVAL_MODE and never in production. EVAL_CANARY may override it with letters, digits,
 * underscore or hyphen (8 to 64 characters, because it is written into a prompt); anything else uses the default.
 */
export function getEvalCanary(): string | undefined {
  if (!evalModeEnabled()) return undefined;
  const custom = process.env.EVAL_CANARY?.trim();
  return custom && /^[A-Za-z0-9_-]{8,64}$/.test(custom) ? custom : DEFAULT_CANARY;
}

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
  /** Daily calls for an anonymous (not email-upgraded) user. */
  dailyAnonLimit: number | undefined;
}

/** A bad value is treated as unset for that one limit; the names of bad variables come from invalidEnvNames. */
export function getLimits(): UsageLimits {
  const user = z.coerce.number().int().positive().safeParse(process.env.AI_DAILY_USER_LIMIT);
  const spend = z.coerce.number().positive().safeParse(process.env.AI_DAILY_GLOBAL_SPEND_CAP_USD);
  const anon = z.coerce.number().int().positive().safeParse(process.env.AI_DAILY_ANON_LIMIT);
  return {
    dailyAnonLimit: anon.success ? anon.data : undefined,
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

/**
 * Everything wrong with the AI configuration, as names only (never a value), for /api/ready and a startup log line.
 * Empty means ready. Includes variables that fail validation and the mock guard: MOCK_AI=1 on a Vercel production
 * deployment is reported as MOCK_AI_BLOCKED_IN_PRODUCTION (the guard already ignores it), and mock answers being served on
 * any deployment as MOCK_AI_ACTIVE.
 */
export function runtimeConfigProblems(): string[] {
  const problems = new Set<string>(invalidEnvNames());
  try {
    assertRuntimeEnv();
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    for (const n of e.names) problems.add(n);
  }
  if (process.env.MOCK_AI === "1" && isVercelProduction() && process.env.ALLOW_MOCK_IN_PROD !== "1") problems.add("MOCK_AI_BLOCKED_IN_PRODUCTION");
  if (mockOutsideLocalDev()) problems.add("MOCK_AI_ACTIVE");
  return [...problems];
}

/** Public address on /contact (NEXT_PUBLIC_CONTACT_EMAIL). undefined when unset or not an address. */
export function contactEmail(): string | undefined {
  const parsed = z.string().email().safeParse(process.env.NEXT_PUBLIC_CONTACT_EMAIL);
  return parsed.success ? parsed.data : undefined;
}

export interface CartesiaConfig {
  apiKey: string;
  version: string;
}

/**
 * The text-to-speech key. CARTESIA_VERSION empty means the version this code was written against, so only the key is
 * needed. Throws ConfigError naming CARTESIA_API_KEY (never the value) when it is missing.
 */
export function getCartesiaConfig(): CartesiaConfig {
  const apiKey = nonEmpty.safeParse(process.env.CARTESIA_API_KEY);
  if (!apiKey.success) throw new ConfigError(["CARTESIA_API_KEY"]);
  const version = nonEmpty.safeParse(process.env.CARTESIA_VERSION);
  return { apiKey: apiKey.data, version: version.success ? version.data : CARTESIA_DEFAULT_VERSION };
}
