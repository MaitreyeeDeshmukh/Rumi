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
const CUSTOM_NO_WORDS_ERROR = 'Write a sentence with words in it.';
const CUSTOM_MARKUP_ERROR = 'Links and special markers cannot go on the card.';
const CUSTOM_TOO_COMPLEX_ERROR = 'Make it shorter and clearer: 15 words or fewer, one idea.';
const CUSTOM_FULL_ERROR = 'Your card is full. Remove a line first.';

/** Largest number an id may carry: `u` plus nine digits, far from any exponent form or unsafe integer. */
const MAX_CUSTOM_ID_NUMBER = 999_999_999;
const CUSTOM_ID_RE = /^u(\d{1,9})$/;
/** Line breaks and tabs become one space; every other control, zero-width and bidi character is removed. */
const SPACE_LIKE_RE = /[\r\n\t\u2028\u2029]+/g;
const INVISIBLE_RE = /[\p{Cc}\p{Cf}]/gu;
/** A link, a bare web address, or a prompt-region marker. Plain text on the card is printed and shared as is. */
const MARKUP_RE = /<<<|>>>|https?:|www\.|\b[a-z0-9-]+\.[a-z]{2,}\b/i;

/**
 * Adds one line the person wrote. The line stays on this device (source 'user', never a persona fact). It is cleaned
 * first (control, zero-width and bidi characters removed, spaces collapsed), then must hold at least one letter, no
 * link or `<<<` marker, and be one short, literal sentence (the same lint the AI answers pass) that fits the stored
 * length. The card is returned unchanged, with a fixed message, when the line is not accepted.
 * Ids come from a counter kept on the card (`nextCustomId`), so an id is never reused, even after its line is removed.
 */
export function addCustomItem(card: SupportCard, text: string): { card: SupportCard; error?: string } {
  const line = text.replace(SPACE_LIKE_RE, ' ').replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim();
  if (line === '') return { card, error: CUSTOM_EMPTY_ERROR };
  if (MARKUP_RE.test(line)) return { card, error: CUSTOM_MARKUP_ERROR };
  if (!/\p{L}/u.test(line)) return { card, error: CUSTOM_NO_WORDS_ERROR };
  if (countWords(line) > MAX_CUSTOM_WORDS || line.length > LIMITS.itemTextMax || !literalLint(line).ok) return { card, error: CUSTOM_TOO_COMPLEX_ERROR };
  if (card.items.length >= MAX_SUPPORT_ITEMS) return { card, error: CUSTOM_FULL_ERROR };
  const highest = Math.max(0, ...card.items.map((i) => Number(CUSTOM_ID_RE.exec(i.id)?.[1] ?? 0)));
  const next = Math.max(highest + 1, Number.isSafeInteger(card.nextCustomId) ? (card.nextCustomId as number) : 1);
  if (next > MAX_CUSTOM_ID_NUMBER) return { card, error: CUSTOM_FULL_ERROR };
  return { card: { ...card, nextCustomId: next + 1, items: [...card.items, { id: `u${next}`, text: line, source: 'user', enabled: true }] } };
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
