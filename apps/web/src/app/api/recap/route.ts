import { recapSpec } from "@/features/recap/spec";
import { runTask } from "@/lib/ai/harness";

export const maxDuration = 30;
export const POST = (req: Request): Promise<Response> => runTask(recapSpec, req);
