import { recapFallback } from "@/features/recap/fallback";
import type { RecapReplyT, RecapRequestT } from "@/features/shared/schemas";

/**
 * MOCK_AI recap: built from the request's own lines like the built-in help, without the "degraded" flag.
 * The sample visit gives exactly the saved recap; any other transcript is never answered with sample text.
 */
export function recapMock(r: RecapRequestT): RecapReplyT {
  const reply: RecapReplyT = { ...recapFallback(r) };
  delete reply.degraded;
  return reply;
}
