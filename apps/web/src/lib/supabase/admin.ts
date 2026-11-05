// stub for lane merge: owned by auth. Delete this file at merge; the real module returns the service-role SupabaseClient
// (server-only import, SUPABASE_SECRET_KEY). Observability only needs `.rpc()` and `.from().insert()` from it.
export function getAdminClient(): unknown {
  throw new Error("admin client stub: replaced by the auth lane at merge");
}
