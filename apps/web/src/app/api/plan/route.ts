import { planSpec } from "@/features/plan/spec";
import { runTask } from "@/lib/ai/harness";

export const maxDuration = 30;
export const POST = (req: Request): Promise<Response> => runTask(planSpec, req);
