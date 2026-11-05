import { requestIdOf } from "@/lib/requestContext";
import { getRelease } from "@/lib/telemetry/config";

export const dynamic = "force-dynamic";

/** Liveness: the process answers. It checks no dependency on purpose, so a database outage cannot make the platform restart a healthy server. */
export function GET(req: Request): Response {
  return Response.json({ ok: true, release: getRelease() }, { headers: { "Cache-Control": "no-store", "x-request-id": requestIdOf(req) } });
}
