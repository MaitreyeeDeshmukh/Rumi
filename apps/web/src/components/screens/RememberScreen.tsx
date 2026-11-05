'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { RecapReply } from '@/features/shared/schemas';
import type { PlanStatus, Recap, RecapSection, Speaker } from '@/features/shared/types';
import { useCrisis } from '../CrisisProvider';
import { COPY } from '../copy';
import { callApi, DEMO_PLAN, SAMPLE_VISIT, SAVED_RECAP_REPLY, useRumi } from '../deps';
import { Banner, Button, ChoiceCard, Icon, Notice, Screen, Status } from '../ui';

const c = COPY.remember;
const SECTIONS: readonly RecapSection[] = ['discussed', 'instructions', 'medications', 'next_steps'];
const STATUS_ORDER: readonly PlanStatus[] = ['asked_by_me', 'asked_by_other', 'not_asked', 'unclear'];
const speakers = Array.from(new Set(SAMPLE_VISIT.map((l) => l.speaker)));

export function RememberScreen() {
  const { state, update } = useRumi();
  const { show } = useCrisis();
  const [phase, setPhase] = useState<'intro' | 'voice'>('intro');
  const [me, setMe] = useState<Speaker | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fails, setFails] = useState(0);
  const [fresh, setFresh] = useState(false);
  const voiceH = useRef<HTMLHeadingElement>(null);
  const recapH = useRef<HTMLHeadingElement>(null);
  const recap = state.recap;

  useEffect(() => { if (phase === 'voice') voiceH.current?.focus(); }, [phase]);
  useEffect(() => { if (fresh && recap) recapH.current?.focus(); }, [fresh, recap]);

  function save(data: z.infer<typeof RecapReply>, speaker: Speaker, fallback: boolean): void {
    const r: Recap = {
      id: `recap-${Date.now()}`, planId: DEMO_PLAN.id, createdAt: new Date().toISOString(), isSample: true, isSavedFallback: fallback,
      mySpeaker: speaker, transcript: SAMPLE_VISIT, items: data.items, unconfirmed: data.unconfirmed, planStatus: data.planStatus,
    };
    update((d) => { d.recap = r; });
    setFresh(true);
  }

  async function run(): Promise<void> {
    if (!me) return;
    setBusy(true); setErr('');
    const res = await callApi('/api/recap', { lines: SAMPLE_VISIT, mySpeaker: me, plan: DEMO_PLAN }, RecapReply);
    setBusy(false);
    if (res.ok) { save(res.data, me, false); return; }
    if ('crisis' in res) { show(); return; }
    const n = fails + 1;
    setFails(n);
    if (n >= 2) { save(SAVED_RECAP_REPLY, me, true); return; }
    setErr(res.error.message);
  }

  if (recap) return <RecapView recap={recap} headingRef={recapH} onRestart={() => { update((d) => { d.recap = undefined; }); setPhase('intro'); setMe(null); setFails(0); setFresh(false); }} />;

  return (
    <Screen title={c.title} lead={c.lead}>
      <p><span className="pill">{c.sampleLabel}</span></p>
      {phase === 'intro' ? (
        <div className="primary-slot"><Button variant="primary" big onClick={() => setPhase('voice')}>{c.useSample}</Button></div>
      ) : (
        <section className="section" aria-labelledby="voice-h">
          <h2 id="voice-h" ref={voiceH} tabIndex={-1}>{c.voiceTitle}</h2>
          <p className="hint">{c.voiceLead}</p>
          <div className="stack">
            {speakers.map((sp) => (
              <ChoiceCard key={sp} title={c.voice(sp)} description={`“${SAMPLE_VISIT.find((l) => l.speaker === sp)?.text ?? ''}”`} pressed={me === sp} onPress={() => setMe(sp)} />
            ))}
          </div>
          {err ? <Notice tone="warn"><p>{err}</p><Button small onClick={() => void run()}>{COPY.common.tryAgain}</Button></Notice> : null}
          <Status busy={busy}>{busy ? c.loading : ''}</Status>
          <div className="primary-slot"><Button variant="primary" big disabled={!me || busy} busy={busy} onClick={() => void run()}>{c.thisIsMe}</Button></div>
        </section>
      )}
    </Screen>
  );
}

function RecapView({ recap, headingRef, onRestart }: { recap: Recap; headingRef: React.RefObject<HTMLHeadingElement | null>; onRestart: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const hl = new Set(selected !== null ? recap.items[selected]?.evidence ?? [] : []);
  const lineNo = new Map(recap.transcript.map((l, i) => [l.id, i + 1]));
  const enabledIds = new Set(DEMO_PLAN.items.filter((i) => i.enabled).map((i) => i.id));

  function pick(i: number): void {
    const next = selected === i ? null : i;
    setSelected(next);
    const first = next !== null ? recap.items[next].evidence[0] : undefined;
    if (first) document.getElementById(`line-${first}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  return (
    <Screen title={c.title} lead={c.lead}>
      <p><span className="pill">{c.sampleLabel}</span></p>
      {recap.isSavedFallback ? <Banner>{c.saved}</Banner> : null}
      <h2 ref={headingRef} tabIndex={-1} className="sr-only">{c.sections.discussed}</h2>
      <div className="stack section">
        {SECTIONS.map((sec) => {
          const items = recap.items.map((it, i) => ({ it, i })).filter(({ it }) => it.section === sec);
          if (!items.length) return null;
          return (
            <section key={sec} className="sum-sec" aria-labelledby={`sec-${sec}`}>
              <h2 id={`sec-${sec}`}>{c.sections[sec]}</h2>
              <ul className="plain-list" style={{ gap: 8 }}>
                {items.map(({ it, i }) => (
                  <li key={i}>
                    <button type="button" className="sum-item" aria-pressed={selected === i} onClick={() => pick(i)}>
                      <span>{it.text}</span>
                      <span className="src">{c.showSource}{it.evidence.length ? c.lines(it.evidence.map((e) => lineNo.get(e)).filter(Boolean).join(', ')) : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {recap.unconfirmed.length ? (
          <section className="sum-sec clarify" aria-labelledby="sec-unconf">
            <h2 id="sec-unconf"><Icon name="alert" />{c.unconfirmed}</h2>
            <p className="hint" style={{ color: 'var(--ink)' }}>{c.unconfirmedLead}</p>
            <ul className="list">{recap.unconfirmed.map((u) => <li key={u}>{u}</li>)}</ul>
          </section>
        ) : null}
      </div>

      <section className="section" aria-labelledby="said-h">
        <h2 id="said-h">{c.saidTitle}</h2>
        {STATUS_ORDER.map((st) => {
          const rows = recap.planStatus.filter((p) => p.status === st && enabledIds.has(p.itemId));
          if (!rows.length) return null;
          return (
            <div key={st}>
              <h3>{c.status[st]}</h3>
              <ul className="list">{rows.map((r) => <li key={r.itemId}>{DEMO_PLAN.items.find((i) => i.id === r.itemId)?.text}</li>)}</ul>
            </div>
          );
        })}
      </section>

      <section className="section" aria-labelledby="tr-h">
        <h2 id="tr-h">{c.transcript}</h2>
        <ol className="transcript">
          {recap.transcript.map((l, i) => (
            <li key={l.id} id={`line-${l.id}`} className={hl.has(l.id) ? 'hl' : undefined}>
              <span className="ln">{i + 1}</span>
              <span>
                <span className="who">{c.voice(l.speaker)}{l.speaker === recap.mySpeaker ? c.youMark : ''}: </span>
                {hl.has(l.id) ? <><mark>{l.text}</mark><span className="sr-only"> ({c.usedInSummary})</span></> : l.text}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <p className="hint"><strong>{c.footer}</strong></p>
      <div className="primary-slot stack">
        <Link className="btn btn-primary big" href="/share">{c.goShare}</Link>
        <Button variant="ghost" onClick={onRestart}>{c.startOver}</Button>
      </div>
    </Screen>
  );
}
