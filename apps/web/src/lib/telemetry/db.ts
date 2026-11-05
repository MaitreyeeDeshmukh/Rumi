import { getAdminClient } from "@/lib/supabase/admin";

/** The two calls observability makes on the service-role client. Narrow on purpose: the whole SupabaseClient is not needed. */
export interface TelemetryDb {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ error: unknown }>;
  from(table: string): { insert(row: Record<string, unknown>): PromiseLike<{ error: unknown }> };
}

/** The admin client seen through TelemetryDb. May throw when the server key is missing; callers handle that. */
export const telemetryDb = (): TelemetryDb => getAdminClient() as unknown as TelemetryDb;
