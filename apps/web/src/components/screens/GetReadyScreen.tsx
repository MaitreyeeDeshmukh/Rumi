'use client';
import { useEffect, useRef, useState } from 'react';
import { PlanReply } from '@/features/shared/schemas';
import type { PlanItem, RumiState, VisitPlan } from '@/features/shared/types';
import { useCrisis } from '../CrisisProvider';
import { COPY } from '../copy';
import { callApi, isCrisis, newSupportCard, syncPersona, useRumi } from '../deps';
import { startListening, useCanListen } from '../speech';
import { Button, Chip, Field, Icon, Notice, Screen, Status, Toggle } from '../ui';
import { SupportCardEditor } from './SupportCardEditor';

const c = COPY.getReady;
const uid = (): string => `u-${Math.random().toString(36).slice(2, 9)}`;

export function GetReadyScreen() {
  const { state, update } = useRumi();
  const { show } = useCrisis();
  const canListen = useCanListen();

  const [raw, setRaw] = useState('');
  const [inputErr, setInputErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [apiErr, setApiErr] = useState('');
  const [draft, setDraft] = useState<VisitPlan | null>(null);
  const [fresh, setFresh] = useState(false);
  const [listening, setListening] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const planHeading = useRef<HTMLHeadingElement>(null);

  const plan = draft ?? state.plan;
  const isSaved = !draft && Boolean(state.plan);

  useEffect(() => { if (fresh) planHeading.current?.focus(); }, [fresh]);
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
    if (res.ok) { setDraft(res.data.plan); setFresh(true); return; }
    if ('crisis' in res) { show(); return; }
    setApiErr(res.error.message);
  }

  async function looksRight(): Promise<void> {
    if (!draft) return;
    const saved = draft;
    update((d: RumiState) => { d.plan = saved; d.supportCard = newSupportCard(saved, d.persona); });
    setDraft(null);
    await syncPersona(state, update);
  }

  function toggleMic(): void {
    if (listening) { stopRef.current?.(); return; }
    const base = raw ? `${raw.trim()} ` : '';
    stopRef.current = startListening((t) => setRaw(base + t), () => { setListening(false); stopRef.current = null; });
    setListening(Boolean(stopRef.current));
  }

  function startOver(): void {
    setDraft(null); setFresh(false); setRaw('');
    update((d) => { d.plan = undefined; d.supportCard = undefined; });
  }

  return (
    <Screen title={c.title} lead={c.lead}>
      {!plan ? (
        <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void makePlan(); }}>
          <Field label={c.label} hint={c.hint} error={inputErr}>
            {(p) => <textarea {...p} ref={boxRef} className="input" rows={5} maxLength={2000} value={raw} onChange={(e) => setRaw(e.target.value)} />}
          </Field>
          {canListen ? (
            <div className="btn-row">
              <Button icon="mic" small onClick={toggleMic} aria-pressed={listening}>{listening ? c.micStop : c.mic}</Button>
              {listening ? <span className="hint">{c.listening}</span> : null}
            </div>
          ) : null}
          <p className="hint">{c.next}</p>
          {apiErr ? <Notice tone="warn"><p>{apiErr}</p><Button small variant="secondary" onClick={() => void makePlan()}>{COPY.common.tryAgain}</Button></Notice> : null}
          <Status busy={busy}>{busy ? c.loading : ''}</Status>
          <div className="primary-slot"><button type="submit" className="btn btn-primary big" aria-busy={busy || undefined} disabled={busy}>{c.make}</button></div>
        </form>
      ) : (
        <PlanEditor plan={plan} saved={isSaved} headingRef={planHeading} onEdit={editPlan} onLooksRight={() => void looksRight()} />
      )}
      {isSaved && state.plan ? (
        <>
          <SupportCardEditor />
          <div className="section"><Button variant="ghost" onClick={startOver}>{c.startOver}</Button></div>
        </>
      ) : null}
    </Screen>
  );
}

function PlanEditor({ plan, saved, headingRef, onEdit, onLooksRight }: {
  plan: VisitPlan; saved: boolean; headingRef: React.RefObject<HTMLHeadingElement | null>;
  onEdit: (fn: (p: VisitPlan) => VisitPlan) => void; onLooksRight: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [removed, setRemoved] = useState<{ item: PlanItem; index: number } | null>(null);
  const [own, setOwn] = useState('');
  const [ownErr, setOwnErr] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setItem = (id: string, patch: Partial<PlanItem>): void => onEdit((p) => ({ ...p, items: p.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

  function remove(item: PlanItem): void {
    const index = plan.items.findIndex((i) => i.id === item.id);
    onEdit((p) => ({ ...p, items: p.items.filter((i) => i.id !== item.id) }));
    setRemoved({ item, index });
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
    setOwn(''); setOwnErr('');
  }

  return (
    <section className="section" aria-labelledby="plan-h">
      <h2 id="plan-h" ref={headingRef} tabIndex={-1}>{c.planTitle}</h2>
      {saved ? <p className="ok-line"><Icon name="check" />{c.saved}</p> : <p className="hint">{c.planLead}</p>}
      <ul className="plain-list">
        {plan.items.map((item) => (
          <li key={item.id} className={`card${item.source === 'suggested' ? ' suggested' : ''}`}>
            <Chip suggested={item.source === 'suggested'}>{item.source === 'user' ? c.youSaid : c.suggested}</Chip>
            {editing === item.id ? (
              <div className="stack" style={{ marginTop: 10 }}>
                <Field label={c.edit}>{(p) => <textarea {...p} className="input" rows={2} maxLength={200} value={editText} onChange={(e) => setEditText(e.target.value)} />}</Field>
                <div className="btn-row">
                  <Button small variant="primary" onClick={() => { if (editText.trim()) setItem(item.id, { text: editText.trim() }); setEditing(null); }}>{c.save}</Button>
                  <Button small variant="ghost" onClick={() => setEditing(null)}>{c.cancel}</Button>
                </div>
              </div>
            ) : <p style={{ margin: '10px 0 0', fontWeight: 700 }}>{item.text}</p>}
            <Toggle label={c.include} checked={item.enabled} onChange={(v) => setItem(item.id, { enabled: v })} />
            <div className="btn-row" style={{ marginTop: 8 }}>
              <Button small variant="ghost" icon="edit" aria-label={`${c.edit}: ${item.text}`} onClick={() => { setEditing(item.id); setEditText(item.text); }}>{c.edit}</Button>
              <Button small variant="ghost" icon="x" aria-label={`${c.remove}: ${item.text}`} onClick={() => remove(item)}>{c.remove}</Button>
            </div>
          </li>
        ))}
      </ul>
      <div role="status" aria-live="polite">
        {removed ? <p className="btn-row">{c.removed} <Button small variant="secondary" icon="undo" onClick={undo}>{c.undo}</Button></p> : null}
      </div>
      <Field label={c.addOwn} hint={c.addOwnHint} error={ownErr}>
        {(p) => (
          <div className="compose-row">
            <input {...p} className="input" value={own} maxLength={200} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOwn(); } }} />
            <Button icon="plus" onClick={addOwn}>{c.add}</Button>
          </div>
        )}
      </Field>
      {!saved ? <div className="primary-slot"><Button variant="primary" big onClick={onLooksRight}>{c.looksRight}</Button></div> : null}
    </section>
  );
}

