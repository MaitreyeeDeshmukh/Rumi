import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/gate";
import { getServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIRST_SIGN_IN_WINDOW_MS = 10_000;

/**
 * The email link lands here with a one-time `code` (PKCE flow: @supabase/ssr's browser client uses it). The code is
 * exchanged for a session cookie, then the person goes to the return path they asked for, else /welcome (first time with
 * this email) or /home. Any fault sends them back to /sign-in?error=link; nothing from Supabase is shown or logged here.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const go = (path: string): NextResponse => {
    const res = NextResponse.redirect(new URL(path, req.url));
    res.cookies.delete({ name: "rumi_next", path: "/auth" });
    return res;
  };
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return go("/sign-in?error=link");
  try {
    const client = await getServerClient();
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error || !data.user || data.user.is_anonymous) return go("/sign-in?error=link");
    // The first confirmation of an address sets email_confirmed_at and last_sign_in_at in the same moment; later sign-ins do not.
    const confirmed = Date.parse(data.user.email_confirmed_at ?? "");
    const lastIn = Date.parse(data.user.last_sign_in_at ?? "");
    const isNew = Number.isFinite(confirmed) && Number.isFinite(lastIn) && Math.abs(lastIn - confirmed) < FIRST_SIGN_IN_WINDOW_MS;
    const next = safeNext(decodeURIComponentSafe(req.cookies.get("rumi_next")?.value));
    return go(next ?? (isNew ? "/welcome" : "/home"));
  } catch {
    return go("/sign-in?error=link");
  }
}

function decodeURIComponentSafe(raw: string | undefined): string | undefined {
  try {
    return raw === undefined ? undefined : decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}
