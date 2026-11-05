import { OWNER_TABLES } from "@/lib/auth/ownerTables";
import { AppError, toResponse } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { requestIdOf, REQUEST_ID_HEADER } from "@/lib/requestContext";
import { guardRequest } from "@/lib/security/guardRequest";
import { getAdminClient } from "@/lib/supabase/admin";

const ROUTE = "/api/account/delete";

/** Supabase's admin API answers 404 `user_not_found` when the user is already gone; a repeat call still verifies and succeeds. */
const alreadyGone = (e: { status?: number; code?: string }): boolean => e.status === 404 || e.code === "user_not_found";

/** Expire every Supabase session cookie the browser sent, so the deleted identity is not presented again. */
function expiredSessionCookies(req: Request): string[] {
  const names = (req.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.split("=")[0].trim())
    .filter((n) => n.startsWith("sb-"));
  return names.map((n) => `${n}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

/**
 * Deletes the signed-in person's account. Same-origin and signed in only. The auth user is removed with the admin API
 * (every owner row follows by ON DELETE CASCADE), then every owner table is counted again: anything left, or any
 * count that fails, is an error, never a success. The id comes from the verified token and nothing else.
 */
export async function POST(req: Request): Promise<Response> {
  const requestId = requestIdOf(req);
  const log = createLogger({ requestId, route: ROUTE });
  try {
    const { user } = await guardRequest(req, { requireAuth: true });
    const admin = getAdminClient();

    const { error } = await admin.auth.admin.deleteUser(user.userId);
    if (error && !alreadyGone(error)) throw new AppError("store_unavailable", { cause: error });

    const counts = await Promise.all(
      OWNER_TABLES.map(async (table) => {
        const { count, error: countError } = await admin.from(table).select("owner_id", { count: "exact", head: true }).eq("owner_id", user.userId);
        return { table, count, failed: countError !== null };
      }),
    );
    const left = counts.filter((c) => c.failed || c.count !== 0).map((c) => c.table);
    if (left.length > 0) {
      log.error("account_delete_rows_remain", new AppError("internal"), { tables: left.join(",") });
      throw new AppError("internal");
    }

    const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", [REQUEST_ID_HEADER]: requestId });
    for (const cookie of expiredSessionCookies(req)) headers.append("Set-Cookie", cookie);
    log.info("account_deleted");
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (e) {
    if (e instanceof AppError && e.status >= 500) log.error("account_delete_failed", e);
    return toResponse(e, requestId);
  }
}
