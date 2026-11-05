import { createLogger } from "@/lib/log";

const WINDOW_MS = 60_000;
let lastLoggedAt = Number.NEGATIVE_INFINITY;

/**
 * Supabase Auth answered 429. That is a fault on our side of the fence (our shared address, or an outage in
 * progress), so it is logged, but at most once a minute per instance: a flood must not become a log flood.
 * Carries the code only; no error text, no user id.
 */
export function noteAuthRateLimited(ctx: { requestId: string; route: string }, now: number = Date.now()): void {
  if (now - lastLoggedAt < WINDOW_MS) return;
  lastLoggedAt = now;
  createLogger(ctx).warn("auth_rate_limited", { code: "rate_limited" });
}
