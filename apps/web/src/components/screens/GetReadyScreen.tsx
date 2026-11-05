'use client';
import { useEffect, useRef, useState } from 'react';
import { PlanReply } from '@/features/shared/schemas';
import type { PlanItem, RumiState, VisitPlan } from '@/features/shared/types';
import { useCrisis } from '../CrisisProvider';
import { COPY } from '../copy';
import { callApi, isCrisis, newSupportCard, syncPersona, useRumi } from '../deps';
import { startListening, useCanListen } from '../speech';
import { Button, Chip, Field, Notice, Screen, Status, Steps, Toggle } from '../ui';
import { SupportCardEditor } from './SupportCardEditor';

const c = COPY.getReady;
const uid = (): string => `u-${Math.random().toString(36).slice(2, 9)}`;

/**
 * Three steps, one at a time: 1 say what is going on, 2 check the plan, 3 the support card.
 * Each step has one main button. Nothing from a later step shows early.
 */
export function GetReadyScreen() {
  const { state, update } = useRumi();
  const { show } = useCrisis();
  const canListen = useCanListen();

  const [raw, setRaw] = useState('');
  const [inputErr, setInputErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [apiErr, setApiErr] = useState('');
  const [draft, setDraft] = useState<VisitPlan | null>(null);
  const [changingSaved, setChangingSaved] = useState(false);
  const [listening, setListening] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);

  const step: 1 | 2 | 3 = draft || (state.plan && changingSaved) ? 2 : state.plan ? 3 : 1;
  const plan = draft ?? state.plan;

  // Move focus to the step heading whenever the step changes, so screen readers hear where they are.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    stepHeading.current?.focus();
  }, [step]);
  useEffect(() => () => stopRef.current?.(), []);

  const editPlan = (fn: (p: VisitPlan) => VisitPlan): void => {
    if (draft) { setDraft(fn(draft)); return; }
    update((d) => { if (d.plan) d.plan = fn(d.plan); });
  };

  async function makePlan(): Promise<void> {
    const text = raw.trim();
    if (!text) { setInputErr(c.blank); boxRef.current?.focus(); return; }
    setInputErr('');
    if (isCrisis(text)) { show(); return; }
    setBusy(true); setApiErr('');
    const memoryCode = state.settings.memoryOptIn ? state.persona.recoveryCode : undefined;
    const res = await callApi('/api/plan', { rawText: text, companionName: state.settings.companionName || 'Rumi' }, PlanReply, { memoryCode });
    setBusy(false);
    if (res.ok) { setDraft(res.data.plan); return; }
    if ('crisis' in res) { show(); return; }
    setApiErr(res.error.message);
  }

  async function looksRight(): Promise<void> {
    if (draft) {
      const saved = draft;
      update((d: RumiState) => { d.plan = saved; d.supportCard = newSupportCard(saved, d.persona); });
      setDraft(null);
    }
    setChangingSaved(false);
    await syncPersona(state, update);
  }

  function toggleMic(): void {
    if (listening) { stopRef.current?.(); return; }
    const base = raw ? `${raw.trim()} ` : '';
    stopRef.current = startListening((t) => setRaw(base + t), () => { setListening(false); stopRef.current = null; });
    setListening(Boolean(stopRef.current));
  }

  function startOver(): void {
    setDraft(null); setChangingSaved(false); setRaw('');
    update((d) => { d.plan = undefined; d.supportCard = undefined; });
  }

  const stepName = step === 1 ? c.step1 : step === 2 ? c.step2 : c.step3;

  return (
    <Screen title={c.title} lead={c.lead}>
      <Steps current={step} total={3} name={stepName} />
      <h2 ref={stepHeading} tabIndex={-1} className="sr-only">{stepName}</h2>

      {step === 1 ? (
        <form className="stack-lg" noValidate onSubmit={(e) => { e.preventDefault(); void makePlan(); }}>
          <Field label={c.label} hint={c.hint} error={inputErr}>
            {(p) => <textarea {...p} ref={boxRef} className="input" rows={5} maxLength={2000} value={raw} onChange={(e) => setRaw(e.target.value)} />}
          </Field>
          {canListen ? (
            <div className="btn-row">
              <Button icon="mic" small onClick={toggleMic} aria-pressed={listening}>{listening ? c.micStop : c.mic}</Button>
              {listening ? <span className="hint">{c.listening}</span> : null}
            </div>
          ) : null}
          {apiErr ? <Notice tone="warn"><p>{apiErr}</p><Button small onClick={() => void makePlan()}>{COPY.common.tryAgain}</Button></Notice> : null}
          <div>
            <p className="hint">{c.next}</p>
            <Status busy={busy}>{busy ? c.loading : ''}</Status>
            <button type="submit" className="btn btn-primary big" aria-busy={busy || undefined} disabled={busy}>{c.make}</button>
          </div>
        </form>
      ) : null}

      {step === 2 && plan ? (
        <PlanEditor plan={plan} onEdit={editPlan} onDone={() => void looksRight()}
          onBack={draft ? () => setDraft(null) : () => setChangingSaved(false)} doneLabel={draft ? c.looksRight : c.done} />
      ) : null}

      {step === 3 && state.plan ? (
        <>
          <SupportCardEditor />
          <div className="section btn-row">
            <Button variant="ghost" onClick={() => setChangingSaved(true)}>{c.changePlan}</Button>
            <Button variant="ghost" onClick={startOver}>{c.startOver}</Button>
          </div>
        </>
      ) : null}
    </Screen>
  );
}

function PlanEditor({ plan, onEdit, onDone, onBack, doneLabel }: {
  plan: VisitPlan; onEdit: (fn: (p: VisitPlan) => VisitPlan) => void; onDone: () => void; onBack: () => void; doneLabel: string;
}) {
  const [open, setOpen] = useState<string | null>(null); // the one item showing Edit and Remove
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [removed, setRemoved] = useState<{ item: PlanItem; index: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [own, setOwn] = useState('');
  const [ownErr, setOwnErr] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setItem = (id: string, patch: Partial<PlanItem>): void => onEdit((p) => ({ ...p, items: p.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

  function remove(item: PlanItem): void {
    const index = plan.items.findIndex((i) => i.id === item.id);
    onEdit((p) => ({ ...p, items: p.items.filter((i) => i.id !== item.id) }));
    setRemoved({ item, index }); setOpen(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRemoved(null), 8000);
  }
  function undo(): void {
    if (!removed) return;
    const r = removed;
    onEdit((p) => { const items = [...p.items]; items.splice(r.index, 0, r.item); return { ...p, items }; });
    setRemoved(null);
  }
  function addOwn(): void {
    const t = own.trim();
    if (!t) { setOwnErr(c.blank); return; }
    if (plan.items.length >= 12) return;
    onEdit((p) => ({ ...p, items: [...p.items, { id: uid(), text: t.slice(0, 200), kind: t.endsWith('?') ? 'question' : 'concern', source: 'user', enabled: true }] }));
    setOwn(''); setOwnErr(''); setAdding(false);
  }

  return (
    <div className="stack-lg">
      <p className="hint">{c.planLead}</p>
      <ul className="plain-list">
        {plan.items.map((item) => (
          <li key={item.id} className={`plan-item${item.source === 'suggested' ? ' suggested' : ''}`}>
            <span><Chip suggested={item.source === 'suggested'}>{item.source === 'user' ? c.youSaid : c.suggested}</Chip></span>
            {editing === item.id ? (
              <div className="stack">
                <Field label={c.edit}>{(p) => <textarea {...p} className="input" rows={2} maxLength={200} value={editText} onChange={(e) => setEditText(e.target.value)} />}</Field>
                <div className="btn-row">
                  <Button small variant="primary" onClick={() => { if (editText.trim()) setItem(item.id, { text: editText.trim() }); setEditing(null); setOpen(null); }}>{c.save}</Button>
                  <Button small variant="ghost" onClick={() => setEditing(null)}>{c.cancel}</Button>
                </div>
              </div>
            ) : <p className="plan-item-text">{item.text}</p>}
            <Toggle label={c.include} checked={item.enabled} onChange={(v) => setItem(item.id, { enabled: v })} />
            {editing !== item.id ? (
              open === item.id ? (
                <div className="btn-row">
                  <Button small variant="secondary" icon="edit" aria-label={`${c.edit}: ${item.text}`} onClick={() => { setEditing(item.id); setEditText(item.text); }}>{c.edit}</Button>
                  <Button small variant="secondary" icon="x" aria-label={`${c.remove}: ${item.text}`} onClick={() => remove(item)}>{c.remove}</Button>
                  <Button small variant="ghost" onClick={() => setOpen(null)}>{c.cancel}</Button>
                </div>
              ) : (
                <span><button type="button" className="link" aria-label={`${c.change}: ${item.text}`} onClick={() => setOpen(item.id)}>{c.change}</button></span>
              )
            ) : null}
          </li>
        ))}
      </ul>
      <div role="status" aria-live="polite">
        {removed ? <p className="btn-row">{c.removed} <Button small variant="secondary" icon="undo" onClick={undo}>{c.undo}</Button></p> : null}
      </div>
      {adding ? (
        <Field label={c.addOwn} hint={c.addOwnHint} error={ownErr}>
          {(p) => (
            <div className="compose-row">
              <input {...p} className="input" autoFocus value={own} maxLength={200} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOwn(); } }} />
              <Button icon="plus" onClick={addOwn}>{c.add}</Button>
            </div>
          )}
        </Field>
      ) : (
        <span><Button variant="secondary" icon="plus" onClick={() => setAdding(true)}>{c.addOwn}</Button></span>
      )}
      <div className="stack">
        <Button variant="primary" big onClick={onDone}>{doneLabel}</Button>
        <Button variant="ghost" onClick={onBack}>{c.back}</Button>
      </div>
    </div>
  );
}
