'use client';
import { useEffect, useRef, useState } from 'react';
import { SAY_SCENARIOS, SayItReply } from '@/features/shared/schemas';
import { useCrisis } from '../CrisisProvider';
import { COPY } from '../copy';
import { callApi, useRumi } from '../deps';
import { copyText, speak, useCanSpeak } from '../speech';
import { Button, ChoiceCard, Field, Notice, Screen, Status } from '../ui';

const c = COPY.sayIt;
type Scenario = (typeof SAY_SCENARIOS)[number];

export function SayItScreen() {
  const { state } = useRumi();
  const { show } = useCrisis();
  const canSpeak = useCanSpeak();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [level, setLevel] = useState<2 | 3>(2);
  const [script, setScript] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const [fresh, setFresh] = useState(0);

  useEffect(() => { if (fresh) box.current?.focus(); }, [fresh]);

  async function run(sc: Scenario, lv: 2 | 3): Promise<void> {
    setScenario(sc); setLevel(lv); setBusy(true); setErr(''); setMsg('');
    const memoryCode = state.settings.memoryOptIn ? state.persona.recoveryCode : undefined;
    const res = await callApi('/api/sayit', { level: lv, scenario: sc, companionName: state.settings.companionName || 'Rumi' }, SayItReply, { memoryCode });
    setBusy(false);
    if (res.ok) { setScript(res.data.script); setFresh((n) => n + 1); return; }
    if ('crisis' in res) { show(); return; }
    setErr(res.error.message);
  }

  return (
    <Screen title={c.title} lead={c.lead}>
      <div className="stack">
        {SAY_SCENARIOS.map((sc) => <ChoiceCard key={sc} title={c.scenarios[sc]} pressed={scenario === sc} onPress={() => void run(sc, 2)} />)}
      </div>
      <Status busy={busy}>{busy ? c.loading : ''}</Status>
      {err && scenario ? <Notice tone="warn"><p>{err}</p><Button small onClick={() => void run(scenario, level)}>{COPY.common.tryAgain}</Button></Notice> : null}
      {script && scenario ? (
        <section className="section">
          <Field label={c.scriptLabel} hint={c.scriptHint}>
            {(p) => <textarea {...p} ref={box} className="input" rows={4} value={script} onChange={(e) => setScript(e.target.value)} />}
          </Field>
          <div className="btn-row">
            {canSpeak ? <Button icon="volume" onClick={() => speak(script, state.settings.speechRate)}>{c.readAloud}</Button> : null}
            <Button icon="copy" onClick={async () => setMsg((await copyText(script, box.current)) ? COPY.common.copied : COPY.common.copyFallback)}>{c.copy}</Button>
            {level < 3 ? <Button onClick={() => void run(scenario, 3)} disabled={busy}>{c.simpler}</Button> : null}
          </div>
          <Status>{msg}</Status>
          <p className="hint"><strong>{c.noCall}</strong></p>
        </section>
      ) : null}
    </Screen>
  );
}
