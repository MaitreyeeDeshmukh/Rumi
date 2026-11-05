import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { RumiProvider, useRumi } from '@/features/state/RumiProvider';

function Probe() {
  const { state, hydrated } = useRumi();
  return createElement('p', null, `${hydrated}|${state.settings.companionName}|${state.sessions.length}`);
}

describe('RumiProvider', () => {
  it('server render uses defaults and is not hydrated, so markup matches the first client render', () => {
    const html = renderToString(createElement(RumiProvider, null, createElement(Probe)));
    expect(html).toContain('false|Rumi|0');
  });

  it('useRumi outside the provider throws', () => {
    expect(() => renderToString(createElement(Probe))).toThrow('useRumi outside RumiProvider');
  });
});
