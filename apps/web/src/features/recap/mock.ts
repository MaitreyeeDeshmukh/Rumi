import type { RecapReplyT } from "@/features/shared/schemas";
import { SAVED_RECAP_REPLY } from "@/fixtures/sampleRecap";

/** MOCK_AI recap: the saved recap of the sample visit. */
export const recapMock = (): RecapReplyT => SAVED_RECAP_REPLY;
