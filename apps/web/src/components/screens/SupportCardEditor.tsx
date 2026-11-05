'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { SupportCard } from '@/features/shared/types';
import { COPY } from '../copy';
import { addCustomItem, buildSupportCardText, newSupportCard, syncPersona, useRumi } from '../deps';
import { copyText } from '../speech';
import { Button, Disclosure, Field, Icon, Status, Toggle } from '../ui';

const c = COPY.support;

/** Step 3 of Get ready. The switches show first; extras stay closed until opened. */
export function SupportCardEditor() {
  const { state, update } = useRumi();
  const [own, setOwn] = useState('');
  const [ownErr, setOwnErr] = useState('');
  const [copyMsg, setCopyMsg] = useState('');
  const preRef = useRef<HTMLPreElement>(null);
  const plan = state.plan;
  if (!plan) return null;
  const card: SupportCard = state.supportCard ?? newSupportCard(plan, state.persona);
  const questions = plan.items.filter((i) => i.kind === 'question' && i.enabled);
  const text = buildSupportCardText(card, plan);

  const setCard = (next: SupportCard): void => {
    update((d) => { d.supportCard = next; });
    void syncPersona(state, update);
  };

  function addOwn(): void {
    const r = addCustomItem(card, own);
    if (r.error) { setOwnErr(r.error); return; }
    setOwnErr(''); setOwn(''); setCard(r.card);
  }

  function toggleTop(id: string, on: boolean): void {
    const ids = on ? [...card.topQuestionIds, id].slice(0, 2) : card.topQuestionIds.filter((x) => x !== id);
    setCard({ ...card, topQuestionIds: ids });
  }

  async function copy(): Promise<void> {
    const ok = await copyText(text, preRef.current);
    setCopyMsg(ok ? COPY.common.copied : COPY.common.copyFallback);
  }

  return (
    <div className="stack-lg">
      <p className="ok-line"><Icon name="check" />{COPY.getReady.saved}</p>
      <div>
        <p className="lbl">{c.title}</p>
        <p className="hint">{c.lead}</p>
        {card.items.map((item) => (
          <Toggle key={item.id} label={item.text} checked={item.enabled}
            onChange={(v) => setCard({ ...card, items: card.items.map((i) => (i.id === item.id ? { ...i, enabled: v } : i)) })} />
        ))}
      </div>

      <div>
        <Disclosure summary={c.addOwn}>
          <Field label={c.addOwn} error={ownErr}>
            {(p) => (
              <div className="compose-row">
                <input {...p} className="input" value={own} maxLength={120} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOwn(); } }} />
                <Button icon="plus" onClick={addOwn}>{c.add}</Button>
              </div>
            )}
          </Field>
        </Disclosure>
        <Disclosure summary={c.topLabel}>
          {questions.length === 0 ? <p className="hint">{c.noQuestions}</p> : (
            <fieldset className="field">
              <legend className="sr-only">{c.topLabel}</legend>
              {questions.map((q) => {
                const on = card.topQuestionIds.includes(q.id);
                const full = !on && card.topQuestionIds.length >= 2;
                return (
                  <label key={q.id} className="check-row">
                    <input type="checkbox" checked={on} disabled={full} onChange={(e) => toggleTop(q.id, e.target.checked)} />
                    <span>{q.text}</span>
                    {full ? <span className="hint">{c.topLimit}</span> : null}
                  </label>
                );
              })}
            </fieldset>
          )}
        </Disclosure>
        <Disclosure summary={c.seeCard}>
          <pre ref={preRef} className="printable">{text}</pre>
          <div className="btn-row">
            <Button icon="copy" onClick={() => void copy()}>{c.copy}</Button>
            <Button onClick={() => window.print()}>{c.print}</Button>
          </div>
          <Status>{copyMsg}</Status>
        </Disclosure>
      </div>

      <Link className="btn btn-primary big" href="/practice">{c.goPractice}</Link>
    </div>
  );
}
