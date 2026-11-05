// stub for lane merge: owned by prod-auth. Delete this file at merge. The real one is `import 'server-only'` and builds a service-role client.
// The structural type below covers the only two call shapes the AI runtime uses, so it type-checks against the real SupabaseClient too.
type Result = PromiseLike<{ data: unknown; error: unknown }>;
export interface AdminClientLike {
  rpc(fn: string, args?: Record<string, unknown>): Result;
  from(table: string): { select(columns: string): Result };
}

export function getAdminClient(): AdminClientLike {
  throw new Error("admin client is not configured in this worktree");
}
