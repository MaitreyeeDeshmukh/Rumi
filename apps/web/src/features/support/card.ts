/**
 * The support card: short lines a person can show or read out ("Please speak slowly."). Pure functions.
 */
import { LIMITS } from '@/features/shared/constants';
import type { Persona, SupportCard, SupportItem, VisitPlan } from '@/features/shared/types';
import { countWords, literalLint } from '@/lib/literalLint';
import { MAX_SUPPORT_ITEMS } from '@/lib/storage-schema';
import { MAX_CUSTOM_WORDS, SUPPORT_PRESETS, presetText } from './presets';

const SUPPORT_HEADING = 'How I like to be supported';
export const CONCERN_HEADING = 'My main concern';
const QUESTIONS_HEADING = 'My top questions';
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

const CUSTOM_EMPTY_ERROR = 'Write one sentence first.';
const CUSTOM_TOO_COMPLEX_ERROR = 'Make it shorter and clearer: 15 words or fewer, one idea.';
const CUSTOM_FULL_ERROR = 'Your card is full. Remove a line first.';

/**
 * Adds one line the person wrote. The line stays on this device (source 'user', never a persona fact). It must be
 * one short, literal sentence (the same lint the AI answers pass) that fits the stored length. The card is returned
 * unchanged, with a fixed message, when the line is not accepted.
 */
export function addCustomItem(card: SupportCard, text: string): { card: SupportCard; error?: string } {
  const line = text.trim();
  if (line === '') return { card, error: CUSTOM_EMPTY_ERROR };
  if (countWords(line) > MAX_CUSTOM_WORDS || line.length > LIMITS.itemTextMax || !literalLint(line).ok) return { card, error: CUSTOM_TOO_COMPLEX_ERROR };
  if (card.items.length >= MAX_SUPPORT_ITEMS) return { card, error: CUSTOM_FULL_ERROR };
  // Next free number, so removing a line and adding another can never repeat an id.
  const used = card.items.map((i) => /^u(\d+)$/.exec(i.id)?.[1]).filter((n): n is string => n !== undefined).map(Number);
  const id = `u${Math.max(0, ...used) + 1}`;
  return { card: { ...card, items: [...card.items, { id, text: line, source: 'user', enabled: true }] } };
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
