'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { PracticeReply, SayItReply } from '@/features/shared/schemas';
import type { Focus, HelpLevel, PlanItem, PracticeSession, Turn, VisitPlan } from '@/features/shared/types';
import { useCrisis } from '../CrisisProvider';
import { COPY } from '../copy';
import { callApi, FOCUS_LABEL, isCrisis, itemsForFocus, startLevelFor, summarizeSession, syncPersona, useRumi } from '../deps';
import { speak, startListening, useCanListen } from '../speech';
import { Button, ChoiceCard, Icon, Notice, Screen, Sheet, Status, Toggle } from '../ui';

const c = COPY.practice;
const FOCI: readonly Focus[] = ['problem', 'questions', 'needs', 'next_steps', 'whole'];
type Ready = 1 | 2 | 3 | 4 | 5;
const READY: readonly Ready[] = [1, 2, 3, 4, 5];

interface HelpState { item: PlanItem | null; level: 1 | 2 | 3; maxShown: HelpLevel; script: string; loading: boolean; err: string; blanks: string[] }

export function PracticeScreen() {
  const { state, update } = useRumi();
  const plan = state.plan;
  const [phase, setPhase] = useState<'focus' | 'call' | 'summary'>('focus');
  const [focus, setFocus] = useState<Focus>('whole');
  const [readyBefore, setReadyBefore] = useState<Ready | undefined>();
  const [session, setSession] = useState<PracticeSession | null>(null);

  if (!plan) {
    return (
      <Screen title={c.title} lead={c.noPlanLead}>
        <div className="empty"><p>{c.noPlan}</p><Link className="btn btn-primary" href="/get-ready">{COPY.common.goGetReady}</Link></div>
      </Screen>
    );
  }

  function start(): void {
    setSession({ id: `s-${Date.now()}`, planId: plan!.id, startedAt: new Date().toISOString(), focus, readyBefore, turns: [], coveredItemIds: [], helpCount: 0, helpLevelUsed: {} });
    setPhase('call');
  }

  function finish(s: PracticeSession): void {
    setSession(s);
    update((d) => { d.sessions = [...d.sessions.filter((x) => x.id !== s.id), s]; });
    void syncPersona(state, update);
    setPhase('summary');
  }

  if (phase === 'call' && session) return <CallScreen plan={plan} initial={session} onEnd={finish} />;
  if (phase === 'summary' && session) {
    return <Summary plan={plan} session={session} onAgain={() => { setSession(null); setReadyBefore(undefined); setPhase('focus'); }} />;
  }

  return (
    <Screen title={c.title} lead={c.lead}>
      <div className="stack">
        {FOCI.map((f) => <ChoiceCard key={f} title={FOCUS_LABEL[f]} pressed={focus === f} onPress={() => setFocus(f)} />)}
      </div>
      <fieldset className="field section">
        <legend className="lbl">{c.readyLabel}</legend>
        <p className="hint">{c.readyHint}</p>
        <div className="ready-row">
          {READY.map((n) => <button key={n} type="button" aria-pressed={readyBefore === n} onClick={() => setReadyBefore(readyBefore === n ? undefined : n)}>{n}</button>)}
        </div>
      </fieldset>
      <div className="primary-slot"><Button variant="primary" big onClick={start}>{c.start}</Button></div>
    </Screen>
  );
}

// ---------------------------------------------------------------- call

function CallScreen({ plan, initial, onEnd }: { plan: VisitPlan; initial: PracticeSession; onEnd: (s: PracticeSession) => void }) {
  const { state } = useRumi();
  const { show } = useCrisis();
  const canListen = useCanListen();
  const { outputMode, reducedMotion, companionName } = state.settings;
  const voiceOn = outputMode !== 'read';

  const [s, setS] = useState(initial);
  const [repeats, setRepeats] = useState<number[]>([]); // indexes of turns shown again
  const [input, setInput] = useState('');
  const [usedHelpNext, setUsedHelpNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [inputErr, setInputErr] = useState('');
  const [last, setLast] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(state.settings.speechRate);
  const [note, setNote] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [help, setHelp] = useState<HelpState | null>(null);
  const [listening, setListening] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const h1 = useRef<HTMLHeadingElement>(null);
  const logEnd = useRef<HTMLLIElement>(null);
  const started = useRef(false);

  const memoryCode = state.settings.memoryOptIn ? state.persona.recoveryCode : undefined;
  const lastClinician = [...s.turns].reverse().find((t) => t.role === 'clinician')?.text ?? '';

  function sayAloud(text: string): void {
    if (!voiceOn) return;
    speak(text, rate);
    if (!reducedMotion) { setSpeaking(true); setTimeout(() => setSpeaking(false), Math.min(6000, 600 + text.length * 55)); }
  }

  async function ask(turns: Turn[], keepText?: string): Promise<boolean> {
    setBusy(true); setErr('');
    const res = await callApi('/api/practice', { plan, turns, focus: s.focus, companionName: companionName || 'Rumi' }, PracticeReply, { memoryCode });
    setBusy(false);
    if (res.ok) {
      const r = res.data;
      setS((prev) => ({ ...prev, turns: [...turns, { role: 'clinician', text: r.clinicianSay }], coveredItemIds: Array.from(new Set([...prev.coveredItemIds, ...r.coveredItemIds])) }));
      setLast(r.isLastTurn);
      sayAloud(r.clinicianSay);
      return true;
    }
    if ('crisis' in res) { show(); }
    else setErr(res.error.message);
    if (keepText !== undefined) setInput(keepText);
    return false;
  }

  useEffect(() => {
    h1.current?.focus();
    if (started.current) return;
    started.current = true;
    void ask([]);
    // first clinician line only once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'end' }); }, [s.turns.length, repeats.length]);
  useEffect(() => () => { stopRef.current?.(); if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }, []);

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text) { setInputErr(c.blank); return; }
    setInputErr('');
    if (isCrisis(text)) { show(); return; }
    const turns: Turn[] = [...s.turns, { role: 'me', text, ...(usedHelpNext ? { usedHelp: true } : {}) }];
    setInput('');
    const ok = await ask(turns, text);
    if (ok) setUsedHelpNext(false);
  }

  function repeat(): void {
    const idx = s.turns.map((t) => t.role).lastIndexOf('clinician');
    if (idx < 0) return;
    setRepeats((r) => [...r, idx]);
    sayAloud(s.turns[idx].text);
  }

  function slowDown(): void {
    const next = Math.max(0.7, Math.round((rate - 0.15) * 100) / 100);
    setRate(next);
    setNote(c.slower);
    if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(c.slower); u.rate = next; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); }
  }

  function tryAgain(): void {
    const idx = s.turns.map((t) => t.role).lastIndexOf('me');
    if (idx < 0) return;
    setInput(s.turns[idx].text);
    setUsedHelpNext(Boolean(s.turns[idx].usedHelp));
    setS((prev) => ({ ...prev, turns: prev.turns.slice(0, idx) }));
    setRepeats((r) => r.filter((i) => i < idx));
    setLast(false);
  }

  async function loadHelp(item: PlanItem | null, level: 1 | 2 | 3, firstOpen: boolean): Promise<void> {
    setHelp((h) => ({ item, level, maxShown: h?.maxShown ?? 0, script: '', loading: true, err: '', blanks: [] }));
    if (firstOpen) setS((prev) => ({ ...prev, helpCount: prev.helpCount + 1 }));
    const res = await callApi('/api/sayit', {
      level, clinicianQuestion: lastClinician || 'What brings you in today?', mainConcern: plan.mainConcern,
      symptomsInMyWords: plan.symptomsInMyWords, companionName: companionName || 'Rumi',
    }, SayItReply, { memoryCode });
    if (!res.ok) {
      if ('crisis' in res) { setHelp(null); show(); return; }
      setHelp((h) => (h ? { ...h, loading: false, err: res.error.message } : h));
      return;
    }
    const nBlanks = (res.data.script.match(/\[[^\]]+\]/g) ?? []).length;
    setHelp({ item, level, maxShown: level, script: res.data.script, loading: false, err: '', blanks: Array(nBlanks).fill('') });
    if (item) setS((prev) => ({ ...prev, helpLevelUsed: { ...prev.helpLevelUsed, [item.id]: Math.max(prev.helpLevelUsed[item.id] ?? 0, level) as HelpLevel } }));
  }

  function openHelp(): void {
    const item = itemsForFocus(plan, s.focus).find((i) => !s.coveredItemIds.includes(i.id)) ?? null;
    const level = Math.min(3, Math.max(1, item ? startLevelFor(state, item.kind) : 1)) as 1 | 2 | 3;
    void loadHelp(item, level, true);
  }

  function useHelp(): void {
    if (!help) return;
    let n = 0;
    const text = help.level === 1 ? '' : help.script.replace(/\[[^\]]+\]/g, (m) => help.blanks[n++]?.trim() || m.slice(1, -1));
    setInput(text);
    setUsedHelpNext(true);
    setHelp(null);
  }

  function toggleMic(): void {
    if (listening) { stopRef.current?.(); return; }
    stopRef.current = startListening((t) => setInput(t), () => { setListening(false); stopRef.current = null; });
    setListening(Boolean(stopRef.current));
  }

  // Render the log: every turn, plus repeated clinician lines right after the latest turn.
  const log: { key: string; turn: Turn; repeated: boolean }[] = s.turns.map((t, i) => ({ key: `t${i}`, turn: t, repeated: false }));
  repeats.forEach((idx, n) => { if (s.turns[idx]) log.push({ key: `r${n}`, turn: s.turns[idx], repeated: true }); });

  return (
    <div className="call" role="region" aria-label={c.title}>
      <p className="banner">{c.banner}</p>
      <div className="call-stage">
        <DoctorAvatar speaking={speaking && !reducedMotion} />
        <h1 ref={h1} tabIndex={-1}>{c.clinician}</h1>
        <span className="hint" style={{ color: 'var(--call-muted)' }}>{FOCUS_LABEL[s.focus]}</span>
      </div>
      <ol className="call-log" aria-live="polite" aria-label={c.title}>
        {log.map(({ key, turn, repeated }) => (
          <li key={key} className={`cbub ${turn.role === 'me' ? 'me' : 'doc'}`}>
            <span className="cbub-who">{turn.role === 'me' ? c.you : c.clinician}{repeated ? ` ${c.repeated}` : ''}</span>
            {turn.text}
          </li>
        ))}
        <li ref={logEnd} aria-hidden="true" style={{ listStyle: 'none', height: 1 }} />
      </ol>
      <div className="call-compose">
        <p className="sr-only" role="status" aria-live="polite">{busy ? c.thinking : note}</p>
        {busy ? <p className="call-err" style={{ color: 'var(--call-muted)' }}>{c.thinking}</p> : null}
        {note && !busy ? <p className="call-err" style={{ color: 'var(--call-muted)' }}>{note}</p> : null}
        {err ? <div className="notice warn"><Icon name="alert" /><div><p>{err}</p><Button small onClick={() => void (input.trim() ? send() : ask(s.turns))}>{COPY.common.tryAgain}</Button></div></div> : null}
        {inputErr ? <p className="call-err" id="answer-err">{inputErr}</p> : null}
        {last ? (
          <Button variant="primary" big onClick={() => onEnd(s)}>{c.seeSummary}</Button>
        ) : (
          <form className="compose-row" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <label htmlFor="answer" className="sr-only">{c.answerLabel}</label>
            <textarea id="answer" className="call-input" rows={1} value={input} disabled={paused} aria-invalid={inputErr ? true : undefined} aria-describedby={inputErr ? 'answer-err' : undefined}
              onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
            {canListen ? <button type="button" className="call-send" aria-pressed={listening} onClick={toggleMic} disabled={paused}><Icon name="mic" label={c.mic} /></button> : null}
            <button type="submit" className="call-send" disabled={busy || paused} aria-busy={busy || undefined}>{c.send}</button>
          </form>
        )}
      </div>
      <div className="call-controls">
        <button type="button" onClick={() => setPaused(true)}><Icon name="pause" />{c.pause}</button>
        <button type="button" onClick={repeat} disabled={!lastClinician}><Icon name="repeat" />{c.repeat}</button>
        {voiceOn ? <button type="button" onClick={slowDown} disabled={rate <= 0.7}><Icon name="slow" />{c.slow}</button> : null}
        <button type="button" onClick={openHelp} disabled={busy}><Icon name="hand" />{c.help}</button>
        <button type="button" onClick={() => setPlanOpen(true)}><Icon name="list" />{c.showPlan}</button>
        <button type="button" onClick={tryAgain} disabled={busy || !s.turns.some((t) => t.role === 'me')}><Icon name="undo" />{c.tryAgainTurn}</button>
        <button type="button" className="end" onClick={() => setEndOpen(true)}><Icon name="end" />{c.end}</button>
      </div>

      {paused ? (
        <div className="pause-overlay" role="dialog" aria-modal="true" aria-labelledby="paused-t">
          <div>
            <strong id="paused-t">{c.paused}</strong>
            <p>{c.pausedText}</p>
            <Button variant="primary" autoFocus onClick={() => setPaused(false)}>{c.resume}</Button>
          </div>
        </div>
      ) : null}

      <Sheet open={planOpen} title={c.showPlan} onClose={() => setPlanOpen(false)}>
        <ul className="list">{plan.items.filter((i) => i.enabled).map((i) => <li key={i.id}>{i.text}{s.coveredItemIds.includes(i.id) ? ` (${COPY.summary.saidIt})` : ''}</li>)}</ul>
      </Sheet>

      <Sheet open={endOpen} title={c.endConfirm} onClose={() => setEndOpen(false)}>
        <div className="btn-row">
          <Button variant="primary" onClick={() => { setEndOpen(false); onEnd(s); }}>{c.endYes}</Button>
          <Button onClick={() => setEndOpen(false)}>{c.endNo}</Button>
        </div>
      </Sheet>

      <Sheet open={help !== null} title={c.help} onClose={() => setHelp(null)}>
        {help ? <HelpBody help={help} setBlanks={(b) => setHelp({ ...help, blanks: b })} onUse={useHelp}
          onMore={() => void loadHelp(help.item, Math.min(3, help.level + 1) as 1 | 2 | 3, false)} onClose={() => setHelp(null)}
          onRetry={() => void loadHelp(help.item, help.level, false)} /> : null}
      </Sheet>
    </div>
  );
}

function HelpBody({ help, setBlanks, onUse, onMore, onClose, onRetry }: {
  help: HelpState; setBlanks: (b: string[]) => void; onUse: () => void; onMore: () => void; onClose: () => void; onRetry: () => void;
}) {
  const levelName = help.level === 1 ? c.helpLevel1 : help.level === 2 ? c.helpLevel2 : c.helpLevel3;
  const parts = help.script.split(/(\[[^\]]+\])/g);
  const isBlank = (p: string): boolean => /^\[[^\]]+\]$/.test(p);
  const blankIndex = parts.map((p, i) => (isBlank(p) ? parts.slice(0, i).filter(isBlank).length : -1));
  return (
    <div className="stack">
      {help.item ? <p className="hint">{help.item.text}</p> : null}
      <Status busy={help.loading}>{help.loading ? c.helpLoading : levelName}</Status>
      {help.err ? <Notice tone="warn"><p>{help.err}</p><Button small onClick={onRetry}>{COPY.common.tryAgain}</Button></Notice> : null}
      {!help.loading && help.script ? (
        help.level === 2 ? (
          <p style={{ fontSize: '1.1rem', lineHeight: 2 }}>
            {parts.map((p, i) => {
              const n = blankIndex[i];
              if (n < 0) return <span key={i}>{p}</span>;
              return (
                <input key={i} className="input say-blank" aria-label={p.slice(1, -1)} placeholder={p.slice(1, -1)} value={help.blanks[n] ?? ''}
                  size={Math.max(8, p.length)} onChange={(e) => { const next = [...help.blanks]; next[n] = e.target.value; setBlanks(next); }} />
              );
            })}
          </p>
        ) : <p className="card" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{help.script}</p>
      ) : null}
      <div className="btn-row">
        {help.level > 1 && help.script ? <Button variant="primary" onClick={onUse}>{c.useThis}</Button> : null}
        {help.level < 3 ? <Button onClick={onMore} disabled={help.loading}>{c.moreHelp}</Button> : null}
        <Button variant="ghost" onClick={onClose}>{COPY.common.close}</Button>
      </div>
    </div>
  );
}

function DoctorAvatar({ speaking }: { speaking: boolean }) {
  return (
    <svg viewBox="0 0 200 200" className={`doc-av${speaking ? ' speaking' : ''}`} aria-hidden="true">
      <circle cx="100" cy="100" r="96" fill="#3A3650" />
      <circle cx="100" cy="100" r="96" fill="none" stroke="#BBAAE8" strokeWidth="4" className="speak-ring" />
      <path d="M38 196c6-38 30-56 62-56s56 18 62 56Z" fill="#F4F2F8" />
      <path d="M84 142l16 22 16-22" fill="#DCEAF4" />
      <path d="M70 150c-4 18 2 30 14 32" stroke="#66558D" strokeWidth="4" fill="none" strokeLinecap="round" />
      <rect x="90" y="118" width="20" height="26" rx="8" fill="#C9946F" />
      <ellipse cx="100" cy="92" rx="32" ry="37" fill="#C9946F" />
      <path d="M66 92c-4-30 12-46 34-46 24 0 40 16 34 46-4-14-16-26-34-26-16 0-28 10-34 26Z" fill="#2B2230" />
      <circle cx="88" cy="94" r="3.4" fill="#2A2733" />
      <circle cx="112" cy="94" r="3.4" fill="#2A2733" />
      <path d="M86 84c3-2 7-2 9 0M105 84c3-2 7-2 9 0" stroke="#2A2733" strokeWidth="2" strokeLinecap="round" fill="none" />
      <ellipse cx="100" cy="112" rx="7" ry="3" fill="#8A4B45" className="mouth" />
    </svg>
  );
}

// ---------------------------------------------------------------- summary

function Summary({ plan, session, onAgain }: { plan: VisitPlan; session: PracticeSession; onAgain: () => void }) {
  const { state, update } = useRumi();
  const stored = state.sessions.find((x) => x.id === session.id) ?? session;
  const sum = summarizeSession(stored, plan);
  const [planMsg, setPlanMsg] = useState('');
  const sc = COPY.summary;

  const patch = (fn: (x: PracticeSession) => PracticeSession): void => update((d) => { d.sessions = d.sessions.map((x) => (x.id === stored.id ? fn(x) : x)); });

  // Trend: compare this session with the one before it, per kind of plan item.
  const idx = state.sessions.findIndex((x) => x.id === stored.id);
  const prev = idx > 0 ? state.sessions[idx - 1] : undefined;
  const levelFor = (x: PracticeSession, kind: PlanItem['kind']): HelpLevel | null => {
    const ids = plan.items.filter((i) => i.kind === kind).map((i) => i.id).filter((id) => id in x.helpLevelUsed || x.coveredItemIds.includes(id));
    return ids.length ? (Math.max(...ids.map((id) => x.helpLevelUsed[id] ?? 0)) as HelpLevel) : null;
  };
  const trends = prev ? (['concern', 'question', 'accommodation'] as const).map((k) => {
    const a = levelFor(prev, k); const b = levelFor(stored, k);
    if (a === null || b === null) return null;
    return a === b ? sc.same(sc.levelWords[b]) : sc.trend(sc.levelWords[a], sc.levelWords[b]);
  }).filter((t): t is string => Boolean(t)) : [];

  return (
    <Screen title={sc.title} lead={sc.practiced(FOCUS_LABEL[stored.focus])}>
      <div className="card stack" role="status">
        <p style={{ margin: 0, fontWeight: 800 }}>{sc.saidMyself(sum.saidMyself, sum.total)}</p>
        {sum.saidWithHelp > 0 ? <p style={{ margin: 0 }}>{sc.saidWithHelp(sum.saidWithHelp)}</p> : null}
        <p style={{ margin: 0 }}>{sc.helpUsed(sum.helpCount)}</p>
        {trends.map((t) => <p key={t} style={{ margin: 0 }}>{t}</p>)}
      </div>
      <section className="section" aria-labelledby="said-h">
        <h2 id="said-h">{sc.listTitle}</h2>
        <p className="hint">{sc.listHint}</p>
        <div>
          {sum.items.map(({ item, covered }) => (
            <Toggle key={item.id} label={item.text} description={covered ? sc.saidIt : sc.notYet} checked={covered}
              onChange={(v) => patch((x) => ({ ...x, coveredItemIds: v ? [...x.coveredItemIds, item.id] : x.coveredItemIds.filter((i) => i !== item.id) }))} />
          ))}
        </div>
      </section>
      <fieldset className="field section">
        <legend className="lbl">{sc.afterLabel}</legend>
        <div className="ready-row">
          {READY.map((n) => <button key={n} type="button" aria-pressed={stored.readyAfter === n} onClick={() => patch((x) => ({ ...x, readyAfter: n }))}>{n}</button>)}
        </div>
        {stored.readyBefore && stored.readyAfter ? <p className="ok-line">{sc.beforeAfter(stored.readyBefore, stored.readyAfter)}</p> : null}
      </fieldset>
      <div className="primary-slot stack">
        <Button variant="primary" big onClick={onAgain}>{sc.again}</Button>
        <Button onClick={() => { update((d) => { d.plan = plan; }); setPlanMsg(sc.planSaved); }}>{sc.savePlan}</Button>
        <Status>{planMsg}</Status>
      </div>
    </Screen>
  );
}
