'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import type { ThemeName } from '@/features/shared/types';
import { COPY } from '../copy';
import { useRumi } from '../deps';
import { Button, ChoiceCard, Field, Screen, Segmented, Status } from '../ui';

const w = COPY.welcome;
const THEMES: readonly ThemeName[] = ['soft', 'contrast', 'low'];
const noop = (): (() => void) => () => {};

export function WelcomeScreen() {
  const { state, update } = useRumi();
  const router = useRouter();
  const s = state.settings;
  // Settings sends people here with ?deleted=1 after "Delete everything".
  const deleted = useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).has('deleted'), () => false);

  return (
    <Screen title={w.title} lead={w.lead} footer={false} top={<Link className="link" href="/home">{w.skip}</Link>}>
      <Status>{deleted ? COPY.settings.deleted : ''}</Status>
      <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); router.push('/home'); }}>
        <Field label={w.nameLabel} hint={w.nameHint}>
          {(p) => <input {...p} className="input" autoComplete="given-name" maxLength={40} value={s.name} onChange={(e) => update((d) => { d.settings.name = e.target.value; })} />}
        </Field>
        <Field label={w.helperLabel}>
          {(p) => <input {...p} className="input" maxLength={30} value={s.companionName} onChange={(e) => update((d) => { d.settings.companionName = e.target.value; })}
            onBlur={(e) => { if (!e.target.value.trim()) update((d) => { d.settings.companionName = 'Rumi'; }); }} />}
        </Field>
        <fieldset className="field">
          <legend className="lbl">{w.infoLabel}</legend>
          <div className="stack">
            <Segmented label={w.infoLabel} value={s.outputMode} onChange={(v) => update((d) => { d.settings.outputMode = v; })}
              options={[{ value: 'read', label: w.read }, { value: 'listen', label: w.listen }, { value: 'both', label: w.both }]} />
            <Segmented label={w.infoLabel} value={s.detail} onChange={(v) => update((d) => { d.settings.detail = v; })}
              options={[{ value: 'short', label: w.short }, { value: 'detailed', label: w.detailed }]} />
          </div>
        </fieldset>
        <fieldset className="field">
          <legend className="lbl">{w.lookLabel}</legend>
          <p className="hint">{w.lookHint}</p>
          <div className="stack">
            {THEMES.map((t) => <ChoiceCard key={t} title={COPY.themes[t].title} description={COPY.themes[t].text} pressed={s.theme === t} onPress={() => update((d) => { d.settings.theme = t; })} />)}
          </div>
        </fieldset>
        <div>
          <Button type="submit" variant="primary" big>{w.start}</Button>
          <p className="hint" style={{ marginTop: 12 }}>{w.later}</p>
        </div>
      </form>
    </Screen>
  );
}
