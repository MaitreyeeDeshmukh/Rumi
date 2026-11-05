/**
 * Reads the few variables observability needs. Names only are ever reported, never values.
 * Kept apart from lib/env.ts so this lane does not edit a file other lanes own; the reads are plain and never throw.
 */
import { timingSafeEqual, createHash } from "node:crypto";
import { assertRuntimeEnv, ConfigError } from "@/lib/env";
import { adminConfigProblems } from "@/lib/supabase/admin";

const present = (name: string): boolean => (process.env[name] ?? "").trim() !== "";

/**
 * Short build id for log lines and events: the Vercel commit, else RELEASE (set it on manual deploys), else the Vercel
 * deployment id, else "dev". At most 12 characters.
 */
export function getRelease(): string {
  const raw = [process.env.VERCEL_GIT_COMMIT_SHA, process.env.RELEASE, process.env.VERCEL_DEPLOYMENT_ID].map((v) => (v ?? "").trim()).find((v) => v !== "") ?? "";
  return /^[A-Za-z0-9._-]{1,40}$/.test(raw) ? raw.slice(0, 12) : "dev";
}

/** True when a Sentry DSN is configured. The value itself is read only by the adapter that the app plugs in. */
export const sentryEnabled = (): boolean => present("SENTRY_DSN");

/** True when the process runs on Vercel, whose edge sets the client address headers the rate limiters trust. */
export const onVercel = (): boolean => present("VERCEL");

/** Kill switch: TELEMETRY_DB_WRITES=off stops database telemetry writes. Stdout lines continue. */
export const dbWritesEnabled = (): boolean => (process.env.TELEMETRY_DB_WRITES ?? "").trim().toLowerCase() !== "off";

const digest = (s: string): Buffer => createHash("sha256").update(s).digest();

/** True only when READY_TOKEN is set and `sent` equals it (constant time). An unset token never matches. */
export function readyTokenOk(sent: string | null): boolean {
  const expected = process.env.READY_TOKEN;
  if (sent === null || expected === undefined || expected.trim() === "") return false;
  return timingSafeEqual(digest(sent), digest(expected));
}

/**
 * Names of the variables the server cannot run without: the three Supabase ones, plus whatever env.ts says a live
 * request needs (Groq keys and models, SESSION_SECRET in production). The AI rules are env.ts's, not copied here.
 */
export function missingEnvNames(): string[] {
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"].filter((n) => !present(n)).concat(adminConfigProblems());
  try {
    assertRuntimeEnv();
  } catch (e) {
    // env.ts reports variable names only. Anything else is still a configuration problem, reported without its text.
    names.push(...(e instanceof ConfigError ? e.names : ["runtime_env"]));
  }
  return names;
}
