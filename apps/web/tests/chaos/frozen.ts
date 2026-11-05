/**
 * The frozen application interfaces (08-production-addendum.md section 3) as this suite uses them. A lane module is loaded by
 * path at run time (so this branch typechecks before the lane is merged) and cast to these shapes. When the real module lands,
 * a signature change breaks the test at run time, which is the point: the addendum is the contract.
 */
import type { TaskSpec } from "@/features/shared/task";
import type { RateLimiter } from "@/lib/security/rateLimit";

/** `import()` with a computed specifier: vitest resolves the `@/` alias, tsc does not look for the file. */
export async function loadLane<T>(rel: string): Promise<T> {
  return (await import(/* @vite-ignore */ `@/${rel}`)) as T;
}

/** Same shape as src/lib/ai/provider.ts (Phase 2 brief), restated here because that file reaches this branch with the ai-runtime lane. */
export interface Provider {
  complete(call: { tier: "quality" | "fast"; system: string; user: string; temperature: number; maxOutputTokens: number; signal: AbortSignal }): Promise<{ text: string; modelUsed: string; inTokens: number; outTokens: number }>;
}

export interface HarnessModule {
  runTask<Req, Out, Reply>(spec: TaskSpec<Req, Out, Reply>, req: Request, deps?: { provider?: Provider; limiter?: RateLimiter; now?: () => number; rand?: () => string }): Promise<Response>;
}
export interface ProviderModule {
  createGroqProvider(deps?: { fetchFn?: typeof fetch }): Provider;
}

export type FlagKey = "ai_enabled" | "memory_sync_enabled" | "cloud_sync_enabled";
export interface FlagsModule {
  getFlag(key: FlagKey): Promise<boolean>;
}
export interface LimitsModule {
  checkAndBump(args: { userHash: string | null; ipHash: string; task: "plan" | "practice" | "sayit" | "recap" }): Promise<{ ok: true } | { ok: false; retryAfterSec: number }>;
}
export interface CacheModule {
  singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T>;
}
export interface ErrorsModule {
  AppError: new (...args: never[]) => Error & { code: string; status: number; expose: boolean };
  toResponse(err: unknown, requestId: string): Response;
  fingerprintOf(err: unknown): string;
}
export interface LogModule {
  createLogger(ctx: { requestId: string; route: string }): {
    info(event: string, f?: Record<string, string | number | boolean | undefined>): void;
    warn(event: string, f?: Record<string, string | number | boolean | undefined>): void;
    error(event: string, err: unknown, f?: Record<string, string | number | boolean | undefined>): void;
  };
}
export interface SinksModule {
  recordAiEvent(e: Record<string, unknown>, extra: { cacheStatus: "miss" | "hit" | "bypass"; cachedTokens: number; bucket: string }): void;
  recordAppEvent(e: Record<string, unknown>): void;
}
export interface MapErrorModule {
  mapSupabaseError(e: unknown): { code: string; message: string };
}
export interface RequireUserModule {
  requireUser(req: Request): Promise<{ userId: string; userHash: string; isAnonymous: boolean }>;
}
export interface MemoryStoreModule {
  getMemoryFacts(userId: string): Promise<string[]>;
}
