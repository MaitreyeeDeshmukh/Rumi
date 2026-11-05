'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ThemeName } from '@/features/shared/types';
import { COPY } from '../copy';
import { useRumi } from '../deps';
import { Button, ChoiceCard, Screen, Segmented, Status, Steps } from '../ui';

const w = COPY.welcome;
const THEMES: readonly ThemeName[] = ['soft', 'contrast', 'low'];
const noop = (): (() => void) => () => {};

/** Four questions, one per page. Every question can be skipped. */
export function WelcomeScreen() {
  const { state, update } = useRumi();
  const router = useRouter();
  const s = state.settings;
  const [q, setQ] = useState(0);
  const qHeading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  // Settings sends people here with ?deleted=1 after "Delete everything".
  const deleted = useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).has('deleted'), () => false);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    qHeading.current?.focus();
  }, [q]);

  const last = q === w.questions.length - 1;
  const next = (): void => { if (last) router.push('/home'); else setQ(q + 1); };

  return (
    <Screen title={w.title} lead={w.lead} footer={false} top={<Link className="link" href="/home">{w.skip}</Link>}>
      <Status>{deleted ? COPY.settings.deleted : ''}</Status>
      <Steps current={q + 1} total={w.questions.length} name={w.questions[q]} />
      <form className="one-q" onSubmit={(e) => { e.preventDefault(); next(); }}>
        <h2 ref={qHeading} tabIndex={-1}>
          {q === 0 ? <label htmlFor="q-name">{w.nameLabel}</label> : q === 1 ? <label htmlFor="q-helper">{w.helperLabel}</label> : w.questions[q]}
        </h2>

        {q === 0 ? (
          <>
            <p className="hint" id="q-name-hint">{w.nameHint}</p>
            <input id="q-name" aria-describedby="q-name-hint" className="input" autoComplete="given-name" maxLength={40} value={s.name}
              onChange={(e) => update((d) => { d.settings.name = e.target.value; })} />
          </>
        ) : null}

        {q === 1 ? (
          <input id="q-helper" className="input" maxLength={30} value={s.companionName}
            onChange={(e) => update((d) => { d.settings.companionName = e.target.value; })}
            onBlur={(e) => { if (!e.target.value.trim()) update((d) => { d.settings.companionName = 'Rumi'; }); }} />
        ) : null}

        {q === 2 ? (
          <div className="stack">
            <Segmented label={w.infoLabel} value={s.outputMode} onChange={(v) => update((d) => { d.settings.outputMode = v; })}
              options={[{ value: 'read', label: w.read }, { value: 'listen', label: w.listen }, { value: 'both', label: w.both }]} />
            <Segmented label={w.infoLabel} value={s.detail} onChange={(v) => update((d) => { d.settings.detail = v; })}
              options={[{ value: 'short', label: w.short }, { value: 'detailed', label: w.detailed }]} />
          </div>
        ) : null}

        {q === 3 ? (
          <>
            <p className="hint">{w.lookHint}</p>
            <div className="stack">
              {THEMES.map((t) => <ChoiceCard key={t} title={COPY.themes[t].title} description={COPY.themes[t].text} pressed={s.theme === t} onPress={() => update((d) => { d.settings.theme = t; })} />)}
            </div>
          </>
        ) : null}

        <div className="stack" style={{ marginTop: 'auto' }}>
          <Button type="submit" variant="primary" big>{last ? w.start : w.next}</Button>
          {q > 0 ? <Button variant="ghost" onClick={() => setQ(q - 1)}>{COPY.common.back}</Button> : null}
          {last ? <p className="hint">{w.later}</p> : null}
        </div>
      </form>
    </Screen>
  );
}
