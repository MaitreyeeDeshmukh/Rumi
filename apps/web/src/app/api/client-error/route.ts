import { handleClientError } from "@/lib/telemetry/clientError";

export const dynamic = "force-dynamic";

export const POST = (req: Request): Promise<Response> => handleClientError(req);
