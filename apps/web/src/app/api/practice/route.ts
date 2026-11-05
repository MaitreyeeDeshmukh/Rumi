import { practiceSpec } from "@/features/practice/spec";
import { runTask } from "@/lib/ai/harness";

export const maxDuration = 30;
export const POST = (req: Request): Promise<Response> => runTask(practiceSpec, req);
