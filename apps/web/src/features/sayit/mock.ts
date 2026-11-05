import { sayitFallback } from "@/features/sayit/fallback";
import type { SayItReplyT, SayItRequestT } from "@/features/shared/schemas";

/** MOCK_AI say-it: the same level-aware sentences as the built-in help, without the "degraded" flag. */
export function sayitMock(r: SayItRequestT): SayItReplyT {
  const { script, blanks } = sayitFallback(r);
  return { script, blanks };
}
