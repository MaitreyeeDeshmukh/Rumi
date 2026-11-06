// swap when the lane merges (src/lib/api/client.ts). No network: every path answers from a fixture.
import type { z } from "zod";
import { SHIM_REPLIES } from "@/features/shims/fixtures";
import { sayItShim } from "@/features/shims/sayit";
import type { ApiResult } from "@/features/shims/types";

export async function callApi<Reply>(
  path: keyof typeof SHIM_REPLIES,
  _body: unknown,
  reply: z.ZodType<Reply>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- same signature as the lane's callApi
  _opts?: { memoryCode?: string },
): Promise<ApiResult<Reply>> {
  const parsed = reply.safeParse(path === "/api/sayit" ? sayItShim(_body) : SHIM_REPLIES[path]);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, error: { code: "ai_invalid", message: "Unavailable" } };
}
