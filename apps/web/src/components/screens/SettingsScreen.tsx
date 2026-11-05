'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Settings, ThemeName } from '@/features/shared/types';
import { COPY } from '../copy';
import { useMemoryControls, useRumi } from '../deps';
import { copyText } from '../speech';
import { Button, ChoiceCard, Field, Screen, Segmented, Sheet, Status, Toggle } from '../ui';

const c = COPY.settings;
const w = COPY.welcome;
const THEMES: readonly ThemeName[] = ['soft', 'contrast', 'low'];
const SCALES: readonly { value: Settings['textScale']; label: string }[] = [
  { value: 1, label: '100%' }, { value: 1.15, label: '115%' }, { value: 1.3, label: '130%' }, { value: 1.5, label: '150%' },
];

/**
 * The Memory section is hidden until Sujal confirms Supermemory's retention terms and gives the exact
 * retention sentence (plan 04, Settings). Set MEMORY_RETENTION_SENTENCE to that sentence to show it.
 * Until then there is no Memory control at all, so nothing on screen does nothing.
 */
const MEMORY_RETENTION_SENTENCE = '';

export function SettingsScreen() {
  const { state, update, reset } = useRumi();
  const mem = useMemoryControls();
  const router = useRouter();
  const s = state.settings;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]): void => update((d) => { d.settings[k] = v; });
  const [delOpen, setDelOpen] = useState(false);
  const [forgetOpen, setForgetOpen] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [msg, setMsg] = useState('');

  async function deleteAll(): Promise<void> {
    if (s.memoryOptIn) await mem.forgetAll();
    reset();
    setDelOpen(false);
    setMsg(c.deleted);
    router.push('/welcome?deleted=1');
  }

  return (
    <Screen title={c.title} lead={c.lead}>
      <fieldset className="field section">
        <legend className="lbl"><h2 style={{ margin: 0 }}>{c.about}</h2></legend>
        <Field label={w.nameLabel} hint={w.nameHint}>{(p) => <input {...p} className="input" maxLength={40} value={s.name} onChange={(e) => set('name', e.target.value)} />}</Field>
        <Field label={w.helperLabel}>{(p) => <input {...p} className="input" maxLength={30} value={s.companionName} onChange={(e) => set('companionName', e.target.value)} onBlur={(e) => { if (!e.target.value.trim()) set('companionName', 'Rumi'); }} />}</Field>
      </fieldset>

      <fieldset className="field section">
        <legend className="lbl"><h2 style={{ margin: 0 }}>{c.reading}</h2></legend>
        <Segmented label={w.infoLabel} value={s.outputMode} onChange={(v) => set('outputMode', v)}
          options={[{ value: 'read', label: w.read }, { value: 'listen', label: w.listen }, { value: 'both', label: w.both }]} />
        <Segmented label={w.infoLabel} value={s.detail} onChange={(v) => set('detail', v)}
          options={[{ value: 'short', label: w.short }, { value: 'detailed', label: w.detailed }]} />
      </fieldset>

      <fieldset className="field section">
        <legend className="lbl"><h2 style={{ margin: 0 }}>{c.look}</h2></legend>
        <div className="stack">
          {THEMES.map((t) => <ChoiceCard key={t} title={COPY.themes[t].title} description={COPY.themes[t].text} pressed={s.theme === t} onPress={() => set('theme', t)} />)}
        </div>
        <p className="lbl" style={{ marginTop: 14 }}>{c.textSize}</p>
        <Segmented label={c.textSize} value={s.textScale} onChange={(v) => set('textScale', v)} options={SCALES} />
        <Toggle label={c.reduceMotion} description={c.reduceMotionHint} checked={s.reducedMotion} onChange={(v) => set('reducedMotion', v)} />
      </fieldset>

      <fieldset className="field section">
        <legend className="lbl"><h2 style={{ margin: 0 }}>{c.sound}</h2></legend>
        <Toggle label={c.finishSound} checked={s.finishSound} onChange={(v) => set('finishSound', v)} />
      </fieldset>

      {MEMORY_RETENTION_SENTENCE ? (
        <fieldset className="field section">
          <legend className="lbl"><h2 style={{ margin: 0 }}>{c.memTitle}</h2></legend>
          <p>{`Rumi can save short sentences you chose, like “Please speak slowly.”, and how much help you needed. Then you do not start over each time. This is off. If you turn it on, these short sentences are saved with a service called Supermemory. ${MEMORY_RETENTION_SENTENCE} Rumi does not save your health details, your name, or what you write in your plan. You can delete everything at any time.`}</p>
          <Toggle label={c.memToggle} checked={mem.enabled} onChange={(v) => void mem.setEnabled(v)} />
          {mem.enabled && mem.code ? (
            <div className="stack">
              <p className="lbl">{c.memCodeLabel}</p>
              <p className="card mono">{showCode ? mem.code : '•••••• •••••• ••••••'}</p>
              <div className="btn-row">
                <Button small onClick={() => setShowCode(!showCode)}>{showCode ? c.memHide : c.memShow}</Button>
                <Button small icon="copy" onClick={() => void copyText(mem.code ?? '')}>{c.memCopy}</Button>
              </div>
              <p className="notice warn">{c.memWarn}</p>
              <p className="lbl">{c.memList}</p>
              {mem.facts.length ? <ul className="list">{mem.facts.map((f) => <li key={f}>{f}</li>)}</ul> : <p className="hint">{c.memNothing}</p>}
            </div>
          ) : null}
          <Status>{mem.status === 'saved' ? c.memSaved : mem.status === 'error' ? c.memError : ''}</Status>
          <Button variant="secondary" onClick={() => setForgetOpen(true)}>{c.memForget}</Button>
        </fieldset>
      ) : null}

      <section className="section" aria-labelledby="data-h">
        <h2 id="data-h">{c.data}</h2>
        <ul className="list">{c.dataLines.map((l) => <li key={l}>{l}</li>)}</ul>
      </section>

      <section className="section" aria-labelledby="del-h">
        <h2 id="del-h">{c.deleteTitle}</h2>
        <p className="hint">{c.deleteLead}</p>
        <Button variant="danger" onClick={() => setDelOpen(true)}>{c.deleteButton}</Button>
        <Status>{msg}</Status>
      </section>

      <Sheet open={delOpen} title={c.deleteConfirm} onClose={() => setDelOpen(false)}>
        <div className="btn-row">
          <Button onClick={() => setDelOpen(false)}>{c.deleteKeep}</Button>
          <Button variant="danger" onClick={() => void deleteAll()}>{c.deleteYes}</Button>
        </div>
      </Sheet>
      <Sheet open={forgetOpen} title={c.memForgetConfirm} onClose={() => setForgetOpen(false)}>
        <div className="btn-row">
          <Button onClick={() => setForgetOpen(false)}>{c.memKeep}</Button>
          <Button variant="danger" onClick={() => { void mem.forgetAll(); setForgetOpen(false); }}>{c.memDelete}</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
