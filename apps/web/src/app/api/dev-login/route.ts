import { devBypassEmail } from "@/lib/supabase/config";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Developer bypass. Answers with a one-time token hash for the bypass email only; the browser trades it for a real Supabase
 * session (verifyOtp), so every route, RLS policy and the proxy gate see a normal signed-in user with an email. Nothing is emailed.
 * 404 whenever the bypass is off (production builds, or no NEXT_PUBLIC_DEV_BYPASS_EMAIL), and for any other address.
 */
export async function POST(req: Request): Promise<Response> {
  const allowed = devBypassEmail();
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!allowed || email !== allowed) return new Response(null, { status: 404 });
  try {
    // For an address with no account yet, the magic-link call creates it.
    const { data, error } = await getAdminClient().auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data.properties?.hashed_token) return Response.json({ error: "dev_login_failed" }, { status: 503 });
    return Response.json({ tokenHash: data.properties.hashed_token }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "dev_login_failed" }, { status: 503 });
  }
}
