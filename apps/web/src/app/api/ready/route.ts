import { requestIdOf } from "@/lib/requestContext";
import { getRelease, readyTokenOk } from "@/lib/telemetry/config";
import { checkReady } from "@/lib/telemetry/ready";

export const dynamic = "force-dynamic";

/**
 * Readiness: 200 when configuration and the database answer, 503 when not. The public body is only { ok, release }.
 * The NAMES of what failed are added only for a caller that sends the header x-ready-token equal to READY_TOKEN
 * (the alert job). With READY_TOKEN unset, names are never sent.
 */
export async function GET(req: Request): Promise<Response> {
  const requestId = requestIdOf(req);
  const headers = { "Cache-Control": "no-store", "x-request-id": requestId };
  const failed = await checkReady(requestId);
  const release = getRelease();
  if (failed.length === 0) return Response.json({ ok: true, release }, { headers });
  const body = readyTokenOk(req.headers.get("x-ready-token")) ? { ok: false, release, failed } : { ok: false, release };
  return Response.json(body, { status: 503, headers });
}
