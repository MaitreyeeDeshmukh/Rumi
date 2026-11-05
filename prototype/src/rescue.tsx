import { useState, useRef, useApp, Icon, Field, Chip, Choice, ReadAloud, Empty, fmtLong, fmtTime, todayISO, isCrisis, has, copyText, daysFromToday } from './core';
import { RESCUE_FLOWS, SAY_WHO, SAY_GOALS, sayTemplate } from './data';
import { upcomingAppts } from './health';

function RescueShell({ title, children, onExit }: any) {
  const { nav } = useApp();
  return (
    <div className="rescue">
      <header className="rescue-top">
        <button className="btn btn-ghost btn-sm" onClick={onExit || nav.back}><Icon name="back" size={18} />Back</button>
        <span className="rescue-label">{title}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => nav.reset('rescue')}>Exit</button>
      </header>
      <div className="rescue-body">{children}</div>
      <EmergencyLine />
    </div>
  );
}
export function EmergencyLine() {
  return <p className="emergency"><Icon name="alert" size={16} /><span>In immediate danger? Call <strong>911</strong> or your local emergency number. Rumi can't contact emergency services.</span></p>;
}

const OPTIONS = [
  { id: 'changed', label: 'My plans changed', icon: 'cal' },
  { id: 'unsure', label: "I don't know what to do", icon: 'help' },
  { id: 'talk', label: 'I need help talking to someone', icon: 'bubble' },
  { id: 'lost', label: "I'm lost or confused", icon: 'pin' },
  { id: 'over', label: "I'm feeling overwhelmed", icon: 'wind' },
  { id: 'other', label: 'Something else', icon: 'more' },
];

export function RescueHome() {
  const { s, nav } = useApp();
  const [text, setText] = useState('');
  const [crisis, setCrisis] = useState(false);
  const route = (t: string) => {
    if (isCrisis(t)) { setCrisis(true); return; }
    if (has(t, ['bus', 'train', 'ride', 'late', 'missed'])) nav.push('rescueFlow', { flow: 'bus' });
    else if (has(t, ['appointment', 'doctor', 'resched', 'dentist'])) nav.push('rescueAppt', {});
    else if (has(t, ['say', 'call', 'talk', 'ask', 'phone', 'receptionist'])) nav.push('say', {});
    else if (has(t, ['lost', 'where am i', 'confus', "can't find"])) nav.push('rescueFlow', { flow: 'lost' });
    else if (has(t, ['overwhelm', 'too much', 'stress', 'panic', 'loud', 'crowd'])) nav.push('overwhelmed');
    else nav.push('unsure', { text: t });
  };
  return (
    <div className="screen rescue-home">
      <div className="screen-body">
        <div className="rescue-hello">
          <span className="rescue-badge"><Icon name="rescue" size={22} /></span>
          <h1 data-screen-title tabIndex={-1}>I'm here. What's happening?</h1>
          <p className="sub">Pick one, or type it in your own words. We'll take it one step at a time.</p>
        </div>
        <div className="rescue-grid">
          {OPTIONS.map(o => <button key={o.id} className="rescue-opt" onClick={() => {
            if (o.id === 'changed') nav.push('changed');
            else if (o.id === 'unsure') nav.push('unsure', {});
            else if (o.id === 'talk') nav.push('say', {});
            else if (o.id === 'lost') nav.push('rescueFlow', { flow: 'lost' });
            else if (o.id === 'over') nav.push('overwhelmed');
            else { const el = document.getElementById('rtext'); el && el.focus(); }
          }}><Icon name={o.icon} size={24} /><span>{o.label}</span></button>)}
        </div>
        <form className="rescue-type" onSubmit={(e: any) => { e.preventDefault(); if (text.trim()) route(text); }}>
          <label className="lbl" htmlFor="rtext">Or tell {s.profile.companion} what's going on</label>
          <div className="le-row"><input id="rtext" className="input" value={text} onChange={(e: any) => setText(e.target.value)} placeholder="For example, my train isn't coming" /><button className="icon-btn filled" aria-label="Continue" type="submit"><Icon name="send" size={18} /></button></div>
        </form>
        {crisis && <div className="crisis-card" role="alert"><strong>You deserve support right now.</strong><p>If you are thinking about hurting yourself, call or text <strong>988</strong> (Suicide & Crisis Lifeline, US). If you are in danger, call <strong>911</strong> or your local emergency number. Rumi can't contact anyone for you.</p><button className="btn btn-primary" onClick={() => nav.push('trusted', { preset: 'hard' })}>Contact a trusted person</button></div>}
        <button className="btn btn-secondary trusted-cta" onClick={() => nav.push('trusted', {})}><Icon name="phone" size={18} />Contact a trusted person</button>
        <EmergencyLine />
      </div>
    </div>
  );
}

export function Changed() {
  const { nav } = useApp();
  return (
    <RescueShell title="Plans changed">
      <h1 className="r-h" data-screen-title tabIndex={-1}>What changed?</h1>
      <div className="stack">
        <button className="rescue-opt wide" onClick={() => nav.push('rescueFlow', { flow: 'bus' })}><Icon name="bus" size={24} /><span>My bus or ride was canceled</span></button>
        <button className="rescue-opt wide" onClick={() => nav.push('rescueAppt', {})}><Icon name="cal" size={24} /><span>An appointment was moved</span></button>
        <button className="rescue-opt wide" onClick={() => nav.push('say', { who: 'friend', goal: 'cancelplan' })}><Icon name="circles" size={24} /><span>Someone changed our plans</span></button>
        <button className="rescue-opt wide" onClick={() => nav.push('unsure', {})}><Icon name="more" size={24} /><span>Something else</span></button>
      </div>
    </RescueShell>
  );
}

export function RescueFlow({ p }: any) {
  const { s, nav, speak } = useApp();
  const flow = RESCUE_FLOWS[p.flow] || RESCUE_FLOWS.bus;
  const [hist, setHistRaw] = useState(p.hist || [0]);
  const setHist = (h: number[]) => { p.hist = h; setHistRaw(h); };
  const [help, setHelp] = useState(false);
  const idx = hist[hist.length - 1];
  const st = flow.steps[idx];
  const detailed = s.profile.detail === 'detailed';
  const goId = (id: string) => { const i = flow.steps.findIndex(x => x.id === id); setHist([...hist, i]); setHelp(false); };
  const doneStep = () => { if (st.go) goId(st.go); else setHist([...hist, Math.min(idx + 1, flow.steps.length - 1)]); setHelp(false); };
  const back = () => { if (hist.length > 1) { setHist(hist.slice(0, -1)); setHelp(false); } else nav.back(); };
  const say = [st.text, detailed && st.detail, st.list && st.list.join('. ')].filter(Boolean).join('. ');
  return (
    <RescueShell title={flow.title} onExit={back}>
      <p className="step-count">{st.final ? 'Finished' : `Step ${hist.length}`}</p>
      <div className="step-card" key={idx}>
        <h1 className="step-text" data-screen-title tabIndex={-1}>{st.text}</h1>
        {(detailed || st.final) && st.detail && <p className="step-detail">{st.detail}</p>}
        {st.list && <ul className="step-list">{st.list.map(x => <li key={x}>{x}</li>)}</ul>}
        {help && st.help && <div className="help-box" role="status"><Icon name="help" size={18} /><span>{st.help}</span></div>}
        {st.action && <button className="btn btn-secondary" onClick={() => nav.push(st.action!.to, st.action!.p || {})}>{st.action.label}</button>}
      </div>
      {st.options ? <div className="stack">{st.options.map(o => <button key={o.go} className="btn btn-primary big" onClick={() => goId(o.go)}>{o.label}</button>)}</div>
        : st.final ? <div className="stack"><button className="btn btn-primary big" onClick={() => nav.reset('rescue')}><Icon name="check" size={20} />Done</button><button className="btn btn-secondary" onClick={() => nav.reset('home', 'home')}>Go to Home</button></div>
        : <button className="btn btn-primary big" onClick={doneStep}><Icon name="check" size={20} />Done</button>}
      {!st.final && <div className="step-tools">
        <button className="btn btn-secondary" onClick={() => setHelp(!help)} aria-pressed={help} disabled={!st.help}><Icon name="help" size={18} />Help me</button>
        <button className="btn btn-secondary" onClick={back}><Icon name="back" size={18} />Go back</button>
        {s.settings.readAloud && <button className="btn btn-secondary" onClick={() => speak(say)}><Icon name="volume" size={18} />Read aloud</button>}
      </div>}
    </RescueShell>
  );
}

export function RescueAppt({ p }: any) {
  const { s, nav, update, toast } = useApp();
  const list = upcomingAppts(s);
  const [id, setId] = useState(p.id || (list[0] && list[0].id) || '');
  const a = s.appointments.find((x: any) => x.id === id);
  const [nd, setNd] = useState(''); const [nt, setNt] = useState('');
  const [stage, setStage] = useState(0);
  const [applied, setApplied] = useState(false);
  const [err, setErr] = useState('');
  if (!a) return <RescueShell title="Appointment moved"><Empty icon="cal" title="No appointments saved" body="Add your appointment in Health first, then come back here." action={<button className="btn btn-primary" onClick={() => nav.push('newAppt', {}, 'health')}>Add appointment</button>} /></RescueShell>;
  return (
    <RescueShell title="Appointment moved">
      {stage === 0 && <>
        <h1 className="r-h" data-screen-title tabIndex={-1}>Which appointment moved?</h1>
        <div className="stack">{list.map((x: any) => <Choice key={x.id} on={id === x.id} onClick={() => setId(x.id)} title={x.kind} desc={`${fmtLong(x.date)}, ${fmtTime(x.time)}`} />)}</div>
        <Field id="nd" label="New date" error={err}><input id="nd" type="date" min={todayISO()} className="input" value={nd} onChange={(e: any) => { setNd(e.target.value); setErr(''); }} /></Field>
        <Field id="nt" label="New time" optional><input id="nt" type="time" className="input" value={nt} onChange={(e: any) => setNt(e.target.value)} /></Field>
        <button className="btn btn-primary big" onClick={() => { if (!nd) { setErr("Add the new date. If you don't know it yet, pick your best guess and change it later."); return; } setStage(1); }}>Show me what changed</button>
      </>}
      {stage === 1 && <>
        <h1 className="r-h" data-screen-title tabIndex={-1}>Here's the change.</h1>
        <div className="diff">
          <div className="diff-card bg-apricot"><span className="lbl-sm">What changed</span><p><s>{fmtLong(a.date)}, {fmtTime(a.time)}</s></p><p className="to"><Icon name="chev" size={16} /><strong>{fmtLong(nd)}{nt ? ', ' + fmtTime(nt) : ', same time'}</strong></p></div>
          <div className="diff-card bg-sage"><span className="lbl-sm">What stayed the same</span><ul><li>{a.kind}{a.reason ? `, ${a.reason}` : ''}</li><li>{a.mode === 'virtual' ? 'Virtual visit' : 'In person'}{a.provider ? ` with ${a.provider}` : ''}</li><li>Your notes and comfort requests</li></ul></div>
          <div className="diff-card bg-blue"><span className="lbl-sm">What happens next</span>
            <ul className="todo">
              <li><button className="btn btn-secondary btn-sm" disabled={applied} onClick={() => { update((d: any) => { const x = d.appointments.find((y: any) => y.id === a.id); if (x) { x.date = nd; if (nt) x.time = nt; } }); setApplied(true); toast('Appointment updated in Rumi.'); }}>{applied ? <><Icon name="check" size={16} />Updated in Rumi</> : 'Update my Rumi calendar'}</button></li>
              <li>Check how you will get there at the new time.</li>
              <li><button className="btn btn-ghost btn-sm" onClick={() => nav.push('trusted', { preset: 'moved' })}>Tell someone, if you want</button></li>
            </ul>
          </div>
        </div>
        <button className="btn btn-primary big" onClick={() => { if (!applied) { setErr(''); } nav.reset('rescue'); toast(applied ? 'All set.' : 'Closed without changing your calendar.'); }}><Icon name="check" size={20} />Done</button>
      </>}
    </RescueShell>
  );
}

export function SayIt({ p }: any) {
  const { s, toast, speak } = useApp();
  const presetWho = p.preset === 'late' ? 'friend' : p.preset === 'directions' ? 'staff' : p.who || '';
  const presetGoal = p.preset || p.goal || '';
  const [who, setWho] = useState(presetWho);
  const [goal, setGoal] = useState(presetGoal);
  const [place, setPlace] = useState('');
  const next = upcomingAppts(s)[0];
  const [text, setText] = useState(presetGoal ? sayTemplate(presetGoal, s.profile.name, { date: next && fmtLong(next.date) }) : '');
  const ref = useRef(null);
  const pick = (g: string) => { setGoal(g); setText(sayTemplate(g, s.profile.name, { date: next ? fmtLong(next.date) : '', place })); };
  return (
    <RescueShell title="Help me say it">
      {!text ? <>
        <h1 className="r-h" data-screen-title tabIndex={-1}>{who ? 'What do you need to say?' : 'Who do you need to talk to?'}</h1>
        {!who ? <div className="stack">{SAY_WHO.map(w => <button key={w.id} className="rescue-opt wide" onClick={() => setWho(w.id)}><Icon name="bubble" size={22} /><span>{w.label}</span></button>)}</div>
          : <><div className="stack">{SAY_GOALS[who].map(g => <button key={g.id} className="rescue-opt wide" onClick={() => pick(g.id)}><span>{g.label}</span></button>)}</div>
            {who === 'staff' && <Field id="place" label="Where are you going?" optional><input id="place" className="input" value={place} onChange={(e: any) => setPlace(e.target.value)} placeholder="For example, Central Station" /></Field>}
            <button className="btn btn-ghost" onClick={() => setWho('')}>Choose someone else</button></>}
      </> : <>
        <h1 className="r-h" data-screen-title tabIndex={-1}>You can say this.</h1>
        <p className="sub">Change anything you want. It's okay to read it from your screen.</p>
        <label className="sr-only" htmlFor="saytext">Message</label>
        <textarea id="saytext" ref={ref} className="input say-text" rows={6} value={text} onChange={(e: any) => setText(e.target.value)} />
        <div className="step-tools">
          <button className="btn btn-secondary" onClick={() => copyText(text, toast, ref.current)}><Icon name="copy" size={18} />Copy</button>
          {s.settings.readAloud && <button className="btn btn-secondary" onClick={() => speak(text)}><Icon name="volume" size={18} />Speak it</button>}
          <button className="btn btn-secondary" onClick={() => { setText(''); setGoal(''); }}><Icon name="repeat" size={18} />Start over</button>
        </div>
        <div className="help-box"><Icon name="help" size={18} /><span>If you need a moment, you can say "Sorry, give me a second to find my notes."</span></div>
      </>}
    </RescueShell>
  );
}

export function Overwhelmed() {
  const { s, nav } = useApp();
  return (
    <RescueShell title="Overwhelmed">
      <h1 className="r-h" data-screen-title tabIndex={-1}>Let's make things smaller.</h1>
      <p className="sub">Everything here is optional. Pick what sounds useful, or nothing at all.</p>
      <button className="btn btn-primary big" onClick={() => nav.push('trusted', { preset: 'hard' })}><Icon name="phone" size={20} />Contact a trusted person</button>
      <div className="stack">
        <button className="rescue-opt wide" onClick={() => nav.push('breathe')}><Icon name="wind" size={22} /><span>Breathe with a guide</span></button>
        <button className="rescue-opt wide" onClick={() => nav.push('rescueFlow', { flow: 'notice' })}><Icon name="eye" size={22} /><span>Notice what's around me</span></button>
        <button className="rescue-opt wide" onClick={() => nav.push('rescueFlow', { flow: 'quiet' })}><Icon name="door" size={22} /><span>Find a quieter place</span></button>
        <button className="rescue-opt wide" onClick={() => nav.push('startWithMe', {}, 'home')}><Icon name="list" size={22} /><span>Make my next step smaller</span></button>
        <button className="rescue-opt wide" onClick={() => nav.push('pauseHere')}><Icon name="pause" size={22} /><span>Just pause for now</span></button>
      </div>
    </RescueShell>
  );
}

export function Breathe() {
  const { reduced } = useApp();
  const [phase, setPhase] = useState('in');
  const [count, setCount] = useState(0);
  return (
    <RescueShell title="Breathe">
      <h1 className="r-h" data-screen-title tabIndex={-1}>Breathe at your own pace.</h1>
      <p className="sub">Tap the button when you're ready for the next part. There is no timer.</p>
      <div className={'breath ' + phase + (reduced ? ' still' : '')} aria-live="polite"><span>{phase === 'in' ? 'Breathe in slowly' : 'Breathe out slowly'}</span></div>
      <button className="btn btn-primary big" onClick={() => { if (phase === 'out') setCount(count + 1); setPhase(phase === 'in' ? 'out' : 'in'); }}>{phase === 'in' ? "I've breathed in" : "I've breathed out"}</button>
      <p className="hint center">{count} {count === 1 ? 'breath' : 'breaths'}. Stop whenever you like.</p>
    </RescueShell>
  );
}

export function PauseHere() {
  const { nav } = useApp();
  return (
    <RescueShell title="Pause">
      <div className="pause-here">
        <h1 className="r-h" data-screen-title tabIndex={-1}>You can stay here as long as you need.</h1>
        <p className="sub">Nothing is waiting on you in Rumi.</p>
        <button className="btn btn-secondary" onClick={() => nav.reset('rescue')}>I'm ready</button>
      </div>
    </RescueShell>
  );
}

export function Unsure({ p }: any) {
  const { nav } = useApp();
  const [text, setText] = useState(p.text || '');
  const [crisis, setCrisis] = useState(isCrisis(p.text || ''));
  return (
    <RescueShell title="Figuring it out">
      <h1 className="r-h" data-screen-title tabIndex={-1}>What's in front of you right now?</h1>
      <Field id="utext" label="A few words is enough" optional><input id="utext" className="input" value={text} onChange={(e: any) => { setText(e.target.value); setCrisis(isCrisis(e.target.value)); }} placeholder="For example, a form I don't understand" /></Field>
      {crisis && <div className="crisis-card" role="alert"><p>If you are thinking about hurting yourself, call or text <strong>988</strong> (US). If you are in danger, call <strong>911</strong> or your local emergency number.</p></div>}
      <p className="lbl">What would help most?</p>
      <div className="stack">
        <button className="rescue-opt wide" onClick={() => nav.push('startWithMe', { text }, 'home')}><Icon name="list" size={22} /><span>Break it into small steps</span></button>
        <button className="rescue-opt wide" onClick={() => nav.push('say', {})}><Icon name="bubble" size={22} /><span>Help me say something to someone</span></button>
        <button className="rescue-opt wide" onClick={() => nav.push('trusted', { preset: 'help', text })}><Icon name="phone" size={22} /><span>Ask a trusted person</span></button>
        <button className="rescue-opt wide" onClick={() => nav.push('overwhelmed')}><Icon name="wind" size={22} /><span>I need a moment first</span></button>
      </div>
    </RescueShell>
  );
}

export function Trusted({ p }: any) {
  const { s, nav, toast } = useApp();
  const name = s.profile.name || '[your name]';
  const msgFor = (c: any) => {
    const first = c ? c.name.replace(/\s*\(.*\)/, '') : '';
    const hi = `Hi${first ? ' ' + first : ''}, it's ${name}.`;
    if (p.preset === 'lost') return `${hi} I'm a bit lost and could use some help. Could you call or text me when you see this?`;
    if (p.preset === 'moved') return `${hi} My appointment got moved. Could you help me sort out the new plan?`;
    if (p.preset === 'help') return `${hi} I'm not sure what to do about something${p.text ? ` (${p.text})` : ''}. Could you help me think it through?`;
    return `${hi} I'm having a hard time right now and could use some help. Could you call or text me when you can?`;
  };
  const [cid, setCid] = useState(s.contacts[0] ? s.contacts[0].id : '');
  const c = s.contacts.find((x: any) => x.id === cid);
  const [text, setText] = useState(msgFor(c));
  const ref = useRef(null);
  return (
    <RescueShell title="Trusted person">
      <h1 className="r-h" data-screen-title tabIndex={-1}>Reach out to someone you trust.</h1>
      {s.contacts.length === 0 ? <Empty icon="you" title="No trusted contacts yet" body="Add someone in You, then come back." action={<button className="btn btn-primary" onClick={() => nav.push('contacts', {}, 'you')}>Add a trusted contact</button>} /> : <>
        <div className="stack">{s.contacts.map((x: any) => <Choice key={x.id} on={cid === x.id} onClick={() => { setCid(x.id); setText(msgFor(x)); }} title={x.name} desc={`${x.relation} · ${x.phone}`} />)}</div>
        <Field id="tmsg" label="Your message" hint="Change anything you want."><textarea id="tmsg" ref={ref} className="input say-text" rows={4} value={text} onChange={(e: any) => setText(e.target.value)} /></Field>
        <div className="step-tools">
          <button className="btn btn-primary" onClick={() => copyText(text, toast, ref.current)}><Icon name="copy" size={18} />Copy message</button>
          {c && <a className="btn btn-secondary" href={`sms:${c.phone.replace(/[^\d+]/g, '')}`}><Icon name="bubble" size={18} />Open messages</a>}
        </div>
        {c && <p className="hint">Phone number <span className="select-all">{c.phone}</span>. If Open messages doesn't work here, copy the message and send it from your phone.</p>}
        <div className="notice"><Icon name="info" size={18} /><span>Rumi doesn't send messages for you in this preview, and can't confirm a message was sent.</span></div>
      </>}
    </RescueShell>
  );
}
