import { describe, expect, it } from 'vitest';
import { buildSupportCardText, createAddCustomItem, ERR_EMPTY, ERR_UNCLEAR, newSupportCard } from '@/features/support/card';
import { SUPPORT_PRESETS } from '@/features/support/presets';
import type { SupportCard } from '@/features/shared/types';
import { fact, plan } from './fixtures';

// Fake lint until Aakash's literalLint lands: rejects two commands joined by "and".
const addCustomItem = createAddCustomItem((t) => ({ ok: !/\b\w+ .*\band (sit|go|open|take|come)\b/i.test(t) }));

describe('newSupportCard', () => {
  it('has one preset item per preset and enables only what the persona chose', () => {
    const card = newSupportCard(plan(), { facts: [fact('p2')] });
    expect(card.items.map((i) => i.id)).toEqual(SUPPORT_PRESETS.map((p) => p.id));
    expect(card.items.filter((i) => i.enabled).map((i) => i.id)).toEqual(['p2']);
    expect(card.items.every((i) => i.source === 'preset')).toBe(true);
  });

  it('ignores facts of other kinds', () => {
    expect(newSupportCard(undefined, { facts: [fact('p2', 'pacing')] }).items.some((i) => i.enabled)).toBe(false);
  });

  it('top questions are the first two enabled question items', () => {
    expect(newSupportCard(plan(), { facts: [] }).topQuestionIds).toEqual(['q1', 'q3']);
    expect(newSupportCard(undefined, { facts: [] }).topQuestionIds).toEqual([]);
  });
});

describe('addCustomItem', () => {
  const card = (): SupportCard => newSupportCard(undefined, { facts: [] });

  it('appends a trimmed user item', () => {
    const { card: next, error } = addCustomItem(card(), '  Please   use simple words.  ');
    expect(error).toBeUndefined();
    expect(next.items.at(-1)).toEqual({ id: 'u1', text: 'Please use simple words.', source: 'user', enabled: true });
  });

  it('rejects empty text', () => {
    const c = card();
    expect(addCustomItem(c, '   ')).toEqual({ card: c, error: ERR_EMPTY });
  });

  it('rejects more than 15 words and does not append', () => {
    const c = card();
    const r = addCustomItem(c, 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen');
    expect(r.error).toBe(ERR_UNCLEAR);
    expect(r.card.items).toHaveLength(c.items.length);
  });

  it('rejects a double command (lint)', () => {
    expect(addCustomItem(card(), 'Open the door and sit down.').error).toBe(ERR_UNCLEAR);
  });

  it('keeps ids unique after an item is removed', () => {
    let c = addCustomItem(card(), 'Please use simple words.').card;
    c = addCustomItem(c, 'Please face me when you talk.').card;
    c = { ...c, items: c.items.filter((i) => i.id !== 'u1') };
    expect(addCustomItem(c, 'Please show me a picture.').card.items.at(-1)?.id).toBe('u3');
  });
});

describe('buildSupportCardText', () => {
  it('prints the exact layout with only enabled items', () => {
    const c: SupportCard = {
      id: 'support-card', topQuestionIds: ['q1'],
      items: [
        { id: 'p1', text: 'Please speak slowly.', source: 'preset', enabled: true },
        { id: 'p3', text: 'Please write down instructions for me.', source: 'preset', enabled: false },
        { id: 'p5', text: 'I may need extra time to answer.', source: 'preset', enabled: true },
      ],
    };
    expect(buildSupportCardText(c, plan())).toBe([
      'How I like to be supported',
      '- Please speak slowly.',
      '- I may need extra time to answer.',
      '',
      'My main concern',
      'I keep getting headaches',
      '',
      'My top questions',
      '1. I want to ask why I get these headaches.',
    ].join('\n'));
  });

  it('prints at most two top questions', () => {
    const c: SupportCard = { id: 'x', items: [], topQuestionIds: ['q1', 'q3', 'q4'] };
    const text = buildSupportCardText(c, plan());
    expect(text).toContain('1. I want to ask why I get these headaches.');
    expect(text).toContain('2. I want to ask what I can do at school.');
    expect(text).not.toContain('when to come back');
  });

  it('omits empty blocks and returns empty text when nothing is left', () => {
    expect(buildSupportCardText(newSupportCard(undefined, { facts: [] }), undefined)).toBe('');
    const onlyOne = newSupportCard(undefined, { facts: [fact('p1')] });
    expect(buildSupportCardText(onlyOne, undefined)).toBe('How I like to be supported\n- Please speak slowly.');
  });

  it('skips top question ids that are missing or disabled in the plan', () => {
    const c: SupportCard = { id: 'x', items: [], topQuestionIds: ['q2', 'gone'] };
    expect(buildSupportCardText(c, plan())).not.toContain('My top questions');
  });
});
