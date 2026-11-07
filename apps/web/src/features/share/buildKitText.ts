import { buildSupportCardText, newSupportCard } from '@/features/support/card';
import { bringBlock } from '@/features/checklist/bringBlock';
import type { RumiState } from '@/features/shared/types';

/** The "take with me" kit: support card, main concern and the top two questions, then what to bring to the next visit, as plain text. */
export const buildKitText = (state: RumiState, now: Date = new Date()): string =>
  [buildSupportCardText(state.supportCard ?? newSupportCard(state.plan, state.persona), state.plan), bringBlock(state, now)].filter(Boolean).join('\n\n');
