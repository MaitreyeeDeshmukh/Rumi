import { getAdminClient } from "@/lib/supabase/admin";

/** The only database objects observability touches. A new one must be added here on purpose. */
export type TelemetryRpc = "ops_log_app_event" | "ops_ai_usage_total";
export type TelemetryTable = "ops_ai_events" | "ops_app_events";

/** The two calls observability makes on the service-role client. Narrow on purpose: the whole SupabaseClient is not needed. */
export interface TelemetryDb {
  rpc(fn: TelemetryRpc, args?: Record<string, unknown>): PromiseLike<{ error: unknown }>;
  from(table: "ops_ai_events"): { insert(row: Record<string, unknown>): PromiseLike<{ error: unknown }> };
}

/** The admin client seen through TelemetryDb. May throw when the server key is missing; callers handle that. */
export const telemetryDb = (): TelemetryDb => getAdminClient() as unknown as TelemetryDb;
