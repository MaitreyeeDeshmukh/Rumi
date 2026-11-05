// stub for lane merge: owned by prod-auth (frozen signature, addendum section 3; the real one returns a SupabaseClient). Delete this file at merge.
export async function getServerClient(_req?: Request): Promise<never> {
  throw new Error('stub: prod-auth owns lib/supabase/server.ts');
}
