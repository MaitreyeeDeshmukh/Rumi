import type { Instrumentation } from "next";

/** Next.js calls this for every server error nobody caught. The node-only code is loaded on demand, so the edge build never sees it. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportServerFault } = await import("@/lib/telemetry/serverFault");
  reportServerFault(err, context.routePath, request.headers);
};
