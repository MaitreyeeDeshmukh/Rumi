import { describe, expect, it } from 'vitest';
import { buildKitText, buildShareText, EMPTY_SELECTION, RECAP_FOOTER, RECAP_TITLES, SAMPLE_LABEL, shouldPlayFinishSound } from '@/features/share/buildShareText';
import { newSupportCard } from '@/features/support/card';
import { defaultSettings } from '@/lib/storage';
import { fact, plan, recap, stateWith } from './fixtures';

const full = () => stateWith({ plan: plan(), recap: recap(), supportCard: newSupportCard(plan(), { facts: [fact('p1')] }) });

describe('buildShareText', () => {
  it('returns empty text when nothing is selected', () => {
    expect(buildShareText(EMPTY_SELECTION, full())).toBe('');
  });

  it('returns empty text when the selected parts do not exist', () => {
    expect(buildShareText({ ...EMPTY_SELECTION, plan: true, recapSections: { discussed: true }, saidMyself: true }, stateWith({}))).toBe('');
  });

  it('plan only: no recap titles, no footer, only enabled items', () => {
    const text = buildShareText({ ...EMPTY_SELECTION, plan: true }, full());
    expect(text).toContain('I keep getting headaches');
    expect(text).toContain('- pounding behind my eyes');
    expect(text).not.toContain('screens make it worse'); // disabled item
    for (const t of Object.values(RECAP_TITLES)) expect(text).not.toContain(t);
    expect(text).not.toContain(RECAP_FOOTER);
  });

  it('one recap section: labelled as sample and ends with the footer', () => {
    const text = buildShareText({ ...EMPTY_SELECTION, recapSections: { instructions: true } }, full());
    expect(text).toContain(SAMPLE_LABEL);
    expect(text).toContain(`${RECAP_TITLES.instructions}\n- Drink more water.`);
    expect(text).not.toContain(RECAP_TITLES.discussed);
    expect(text.endsWith(RECAP_FOOTER)).toBe(true);
  });

  it('a selected recap section with no items adds no footer', () => {
    expect(buildShareText({ ...EMPTY_SELECTION, recapSections: { medications: true } }, full())).toBe('');
  });

  it('saidMyself splits enabled plan items by status', () => {
    const text = buildShareText({ ...EMPTY_SELECTION, saidMyself: true }, full());
    expect(text).toBe([
      'What I said myself',
      'Asked by me:',
      '- I want to ask why I get these headaches.',
      'Asked by someone else:',
      '- I want to ask what I can do at school.',
      'Not asked:',
      '- I want to ask when to come back.',
      'Not clear:',
      '- I need the lights lower.',
    ].join('\n'));
  });

  it('plan + support card does not repeat the main concern', () => {
    const text = buildShareText({ ...EMPTY_SELECTION, plan: true, supportCard: true }, full());
    expect(text.split('I keep getting headaches')).toHaveLength(2);
    expect(text).toContain('- Please speak slowly.');
  });
});

describe('buildKitText', () => {
  it('contains the support card, main concern and top 2 questions', () => {
    const text = buildKitText(full());
    expect(text).toContain('- Please speak slowly.');
    expect(text).toContain('I keep getting headaches');
    expect(text).toContain('1. I want to ask why I get these headaches.');
    expect(text).toContain('2. I want to ask what I can do at school.');
  });

  it('works before a card was made, using last time\'s choices', () => {
    const text = buildKitText(stateWith({ plan: plan(), persona: { facts: [fact('p5')] } }));
    expect(text).toContain('- I may need extra time to answer.');
  });
});

describe('shouldPlayFinishSound', () => {
  it('is off by default and on only when chosen', () => {
    expect(shouldPlayFinishSound(defaultSettings())).toBe(false);
    expect(shouldPlayFinishSound({ ...defaultSettings(), finishSound: true })).toBe(true);
  });
});
