import { AppError, toResponse } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { requestIdOf, REQUEST_ID_HEADER } from "@/lib/requestContext";
import { guardRequest } from "@/lib/security/guardRequest";
import { getServerClient } from "@/lib/supabase/server";
import { mapSupabaseError } from "@/features/auth/mapError";

const ROUTE = "/api/account/export";

/**
 * Sends the signed-in person every row they own, as a JSON file. The database function runs as the caller
 * (security invoker), so RLS decides what is included; this route adds no id of its own.
 */
export async function GET(req: Request): Promise<Response> {
  const requestId = requestIdOf(req);
  const log = createLogger({ requestId, route: ROUTE });
  try {
    await guardRequest(req, { requireAuth: true });
    const client = await getServerClient(req);
    const { data, error } = await client.rpc("core_export_my_data");
    if (error) {
      const mapped = mapSupabaseError(error);
      throw new AppError(mapped.code === "consent_required" ? "forbidden" : mapped.code, { cause: error });
    }
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="rumi-export.json"',
        "Cache-Control": "no-store",
        [REQUEST_ID_HEADER]: requestId,
      },
    });
  } catch (e) {
    if (e instanceof AppError && e.status >= 500) log.error("account_export_failed", e);
    return toResponse(e, requestId);
  }
}
