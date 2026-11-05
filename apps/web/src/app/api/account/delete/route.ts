import type { SupabaseClient } from "@supabase/supabase-js";
import { OWNER_TABLES } from "@/lib/auth/ownerTables";
import { AppError, asAppError, fingerprintOf, toResponse } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { requestIdOf, REQUEST_ID_HEADER } from "@/lib/requestContext";
import { guardRequest } from "@/lib/security/guardRequest";
import { getAdminClient } from "@/lib/supabase/admin";
import { recordAppEvent } from "@/lib/telemetry/sinks";

const ROUTE = "/api/account/delete";

/** Expire every Supabase session cookie the browser sent, so a deleted or dead identity is not presented again. */
function expiredSessionCookies(req: Request): string[] {
  const names = (req.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.split("=")[0].trim())
    .filter((n) => n.startsWith("sb-"));
  return names.map((n) => `${n}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

/** The owner tables that still hold rows for this user, or whose count could not be read. Empty means erased. */
async function tablesNotErased(admin: SupabaseClient, userId: string): Promise<string[]> {
  const counts = await Promise.all(
    OWNER_TABLES.map(async (table) => {
      const { count, error } = await admin.from(table).select("owner_id", { count: "exact", head: true }).eq("owner_id", userId);
      return { table, left: error !== null || count !== 0 };
    }),
  );
  return counts.filter((c) => c.left).map((c) => c.table);
}

/**
 * Deletes the signed-in person's account. Same-origin and signed in only. The auth user is removed with the admin API
 * (every owner row follows by ON DELETE CASCADE), then every owner table is counted again; a count that fails or
 * shows rows is tried once more, and anything still left is an error, never a success. The id comes from the verified
 * token and nothing else.
 * The session cookies are expired as soon as the user is gone, on the success answer and on any later error answer,
 * and also when the caller was not signed in (their cookie is dead). A repeat call after success is a 401 by design:
 * a deleted user cannot pass requireUser.
 */
export async function POST(req: Request): Promise<Response> {
  const requestId = requestIdOf(req);
  const log = createLogger({ requestId, route: ROUTE });
  let removed = false;
  let guarded = false;
  try {
    const { user } = await guardRequest(req, { requireAuth: true });
    guarded = true;
    const admin = getAdminClient();

    const { error } = await admin.auth.admin.deleteUser(user.userId);
    if (error) throw new AppError("store_unavailable", { cause: error });
    removed = true;

    let left = await tablesNotErased(admin, user.userId);
    if (left.length > 0) left = await tablesNotErased(admin, user.userId);
    if (left.length > 0) {
      log.error("account_delete_rows_remain", new AppError("internal"), { tables: left.join(",") });
      throw new AppError("internal");
    }

    const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", [REQUEST_ID_HEADER]: requestId });
    for (const cookie of expiredSessionCookies(req)) headers.append("Set-Cookie", cookie);
    log.info("account_deleted");
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (e) {
    const fault = asAppError(e);
    if (fault.status >= 500) {
      log.error("account_delete_failed", e);
      // guardRequest counts its own faults; this counts the ones after it. Codes only.
      if (guarded) recordAppEvent({ source: "server", area: "auth", code: fault.code, fingerprint: fingerprintOf(e), route: ROUTE, status: fault.status });
    }
    const res = toResponse(e, requestId);
    if (removed || (e instanceof AppError && e.code === "unauthorized")) {
      for (const cookie of expiredSessionCookies(req)) res.headers.append("Set-Cookie", cookie);
    }
    return res;
  }
}
