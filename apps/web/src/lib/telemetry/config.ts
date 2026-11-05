/**
 * Reads the few variables observability needs. Names only are ever reported, never values.
 * Kept apart from lib/env.ts so this lane does not edit a file other lanes own; the reads are plain and never throw.
 */
const present = (name: string): boolean => (process.env[name] ?? "").trim() !== "";

/** Short build id for log lines and events: the Vercel commit, else RELEASE, else "dev". Never longer than 12 characters. */
export function getRelease(): string {
  const raw = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RELEASE ?? "").trim();
  return /^[A-Za-z0-9._-]{1,40}$/.test(raw) ? raw.slice(0, 12) : "dev";
}

/** True when a Sentry DSN is configured. The value itself is read only by the adapter that the app plugs in. */
export const sentryEnabled = (): boolean => present("SENTRY_DSN");

/** Names of the variables the server cannot run without. AI keys are needed only when the mock is off. */
export function missingEnvNames(): string[] {
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"];
  if (process.env.MOCK_AI !== "1") names.push("GROQ_API_KEY");
  return names.filter((n) => !present(n));
}
