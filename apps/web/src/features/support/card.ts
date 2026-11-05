/**
 * The support card: short lines a person can show or read out ("Please speak slowly."). Pure functions.
 * `addCustomItem` needs `literalLint` from the features lane and is added in Phase 2.
 */
import type { Persona, SupportCard, SupportItem, VisitPlan } from '@/features/shared/types';
import { SUPPORT_PRESETS, presetText } from './presets';

export const SUPPORT_HEADING = 'How I like to be supported';
export const CONCERN_HEADING = 'My main concern';
export const QUESTIONS_HEADING = 'My top questions';
const TOP_QUESTIONS = 2;

/** One item per preset; on only if the person chose it before (a `support_pref` fact for that preset id). */
export function newSupportCard(plan: VisitPlan | undefined, persona: Persona): SupportCard {
  const chosen = new Set(persona.facts.filter((f) => f.kind === 'support_pref').map((f) => f.key));
  return {
    id: 'support-card',
    items: SUPPORT_PRESETS.map((p) => ({ id: p.id, text: p.text, source: 'preset' as const, enabled: chosen.has(p.id) })),
    topQuestionIds: (plan?.items ?? [])
      .filter((i) => i.kind === 'question' && i.enabled)
      .slice(0, TOP_QUESTIONS)
      .map((i) => i.id),
  };
}

/** Preset lines always print the canonical text; a user line prints what the person wrote. */
function lineText(it: SupportItem): string | undefined {
  return it.source === 'preset' ? presetText(it.id) : it.text;
}

/** The "how I like to be supported" block alone, or ''. */
export function supportSection(card: SupportCard): string {
  const lines = card.items.filter((i) => i.enabled).map(lineText).filter((t): t is string => !!t);
  return lines.length ? [SUPPORT_HEADING, ...lines.map((t) => `- ${t}`)].join('\n') : '';
}

/** Plain text, no markdown, so Copy and Print match the screen. '' when nothing is enabled. */
export function buildSupportCardText(card: SupportCard, plan: VisitPlan | undefined): string {
  const concern = plan?.mainConcern.trim();
  const questions = card.topQuestionIds
    .map((id) => plan?.items.find((i) => i.id === id && i.enabled)?.text)
    .filter((t): t is string => !!t)
    .slice(0, TOP_QUESTIONS);
  return [
    supportSection(card),
    concern ? `${CONCERN_HEADING}\n${concern}` : '',
    questions.length ? [QUESTIONS_HEADING, ...questions.map((t, n) => `${n + 1}. ${t}`)].join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
