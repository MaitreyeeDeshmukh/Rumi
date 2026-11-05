import { requestIdOf } from "@/lib/requestContext";
import { getRelease } from "@/lib/telemetry/config";
import { checkReady } from "@/lib/telemetry/ready";

export const dynamic = "force-dynamic";

/** Readiness: 200 when configuration and the database answer, 503 with the NAMES of what failed. For deploy checks and the alert job. */
export async function GET(req: Request): Promise<Response> {
  const requestId = requestIdOf(req);
  const headers = { "Cache-Control": "no-store", "x-request-id": requestId };
  const failed = await checkReady(requestId);
  if (failed.length > 0) return Response.json({ ok: false, failed }, { status: 503, headers });
  return Response.json({ ok: true, release: getRelease() }, { headers });
}
