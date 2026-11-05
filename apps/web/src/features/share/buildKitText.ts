import { buildSupportCardText, newSupportCard } from '@/features/support/card';
import type { RumiState } from '@/features/shared/types';

/** The "take with me" kit: support card, main concern and the top two questions, as plain text. */
export const buildKitText = (state: RumiState): string =>
  buildSupportCardText(state.supportCard ?? newSupportCard(state.plan, state.persona), state.plan);
