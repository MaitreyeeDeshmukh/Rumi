import {
  useState, useEffect, useRef, useApp, Screen, Icon, Field, Chip, Choice, Row, Empty, Sim, Sheet, ReadAloud,
  fmtDate, fmtTime, fmtLong, relDay, todayISO, uid, isCrisis, copyText, addGrowth, daysFromToday, Avatar,
} from './core';
import { SCENARIOS, organizeNotes, callScript, SAMPLE_PROVIDERS, SAMPLE_TRANSCRIPT, SUMMARY_SECTIONS, summarizeTranscript } from './data';

export const upcomingAppts = (s: any) => s.appointments.filter((a: any) => daysFromToday(a.date) >= 0).sort((a: any, b: any) => (a.date + a.time).localeCompare(b.date + b.time));

export function ApptCard({ a, onClick }: any) {
  const d = new Date(a.date + 'T00:00');
  return (
    <button className="appt-card" onClick={onClick}>
      <span className="date-block"><span>{d.toLocaleDateString(undefined, { month: 'short' })}</span><strong>{d.getDate()}</strong></span>
      <span className="appt-main">
        <strong>{a.kind}{a.reason ? <span className="muted"> · {a.reason}</span> : null}</strong>
        <span className="muted">{relDay(a.date)}, {fmtTime(a.time)} · {a.mode === 'virtual' ? 'Virtual' : 'In person'}</span>
        <span className="pill-row">
          {a.status === 'planned' ? <span className="pill pill-warn"><Icon name="phone" size={14} />Not booked yet</span> : <span className="pill pill-ok"><Icon name="check" size={14} />Added by you</span>}
          {a.sample && <Sim>Sample</Sim>}
        </span>
      </span>
      <Icon name="chev" size={18} className="muted" />
    </button>
  );
}

// ---------- Health home ----------
export function HealthHome() {
  const { s, nav } = useApp();
  const up = upcomingAppts(s);
  return (
    <Screen title="Your health" sub="Plan visits, practice what to say, and keep track of what the doctor said." back={false} label="Health">
      <button className="hero-action" onClick={() => nav.push('newAppt')}>
        <span className="hero-ic"><Icon name="plus" size={24} /></span>
        <span><strong>Make an appointment</strong><span>Plan a visit and get a call script</span></span>
        <Icon name="chev" size={20} />
      </button>
      <section className="section">
        <div className="section-head"><h2>Upcoming</h2>{up.length > 0 && <span className="muted small">{up.length} planned</span>}</div>
        {up.length === 0 ? <Empty icon="cal" title="No upcoming appointments" body="When you add one, it shows up here." action={<button className="btn btn-secondary" onClick={() => nav.push('newAppt')}>Add an appointment</button>} />
          : <div className="stack">{up.map((a: any) => <ApptCard key={a.id} a={a} onClick={() => nav.push('appt', { id: a.id })} />)}</div>}
      </section>
      <section className="section">
        <h2>Get ready</h2>
        <div className="grid2">
          <button className="tile bg-lav" onClick={() => nav.push('prep', { apptId: up[0] && up[0].id })}><Icon name="notes" size={26} /><span><strong>Prepare</strong><span>Write what you want to say</span></span></button>
          <button className="tile bg-sage" onClick={() => nav.push('practiceSetup', { apptId: up[0] && up[0].id })}><Icon name="video" size={26} /><span><strong>Practice with {s.profile.companion}</strong><span>A pretend visit, at your pace</span></span></button>
        </div>
      </section>
      <section className="section">
        <h2>During and after</h2>
        <div className="list">
          <Row icon="rec" tone="apricot" title="Record an appointment" desc="With everyone's consent" onClick={() => nav.push('record')} />
          <Row icon="notes" tone="blue" title="My visit summaries" desc={s.summaries.length ? `${s.summaries.length} saved` : 'Try it with a sample visit'} onClick={() => nav.push('summaries')} />
        </div>
      </section>
      <p className="fineprint"><Icon name="info" size={14} />Rumi helps you plan and communicate. It does not give medical advice.</p>
    </Screen>
  );
}

// ---------- New appointment ----------
const KINDS = ['Primary care', 'Dentist', 'Therapy or counseling', 'Eye care', 'Specialist', 'Other'];
const ACCOMS = ['Quiet waiting area', 'Dim lights', 'Explain each step first', 'Extra time to answer', 'Written instructions', 'Bring a support person', 'Wait in my car until called'];

export function NewAppt({ p }: any) {
  const { s, nav, update, toast } = useApp();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ kind: '', kindOther: '', reason: '', provider: '', mode: 'in-person', date: '', time: '', accom: [] as string[], accomNote: '', path: '' });
  const [err, setErr] = useState({} as any);
  const [finder, setFinder] = useState(false);
  const set = (k: string, v: any) => { setF((x: any) => ({ ...x, [k]: v })); setErr((e: any) => ({ ...e, [k]: null })); };
  const steps = ['Visit', 'Provider', 'Date and time', 'Comfort', 'Next step'];

  const validate = () => {
    const e: any = {};
    if (step === 0) { if (!f.kind) e.kind = 'Choose what kind of appointment this is.'; if (f.kind === 'Other' && !f.kindOther.trim()) e.kindOther = 'Tell us what kind of visit it is.'; if (!f.reason.trim()) e.reason = 'Add a reason. A few words is enough.'; }
    if (step === 2) { if (!f.date) e.date = 'Pick a date.'; else if (daysFromToday(f.date) < 0) e.date = 'That date has passed. Pick today or a later date.'; if (!f.time) e.time = 'Pick a time. A rough time is fine.'; }
    if (step === 4 && !f.path) e.path = 'Choose how you want to continue.';
    setErr(e); return Object.keys(e).length === 0;
  };
  const next = () => { if (!validate()) return; setStep(step + 1); const v = document.querySelector('.viewport'); v && v.scrollTo(0, 0); };
  const save = () => {
    if (!validate()) return;
    if (f.path === 'find' && !f.provider) { setFinder(true); return; }
    const id = uid();
    const appt = { id, kind: f.kind === 'Other' ? f.kindOther.trim() : f.kind, reason: f.reason.trim(), provider: f.provider.trim(), mode: f.mode, date: f.date, time: f.time, accom: f.accom, accomNote: f.accomNote.trim(), status: f.path === 'booked' ? 'booked' : 'planned' };
    update((d: any) => { d.appointments.push(appt); });
    nav.replace('apptSaved', { id, path: f.path });
    toast(f.path === 'booked' ? 'Appointment saved.' : 'Plan saved. It is not booked yet.');
  };

  return (
    <Screen title="Make an appointment" label={`Step ${step + 1} of ${steps.length} · ${steps[step]}`} back={true}>
      <div className="progress" aria-hidden="true"><span style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
      {step === 0 && <div className="stack-lg">
        <fieldset className="field"><legend className="lbl">What kind of appointment?</legend>
          <div className="chips">{KINDS.map(k => <Chip key={k} on={f.kind === k} onClick={() => set('kind', k)}>{k}</Chip>)}</div>
          {err.kind && <p className="err" role="alert"><Icon name="alert" size={16} />{err.kind}</p>}
        </fieldset>
        {f.kind === 'Other' && <Field id="kindOther" label="What kind of visit?" error={err.kindOther}><input id="kindOther" className="input" value={f.kindOther} onChange={(e: any) => set('kindOther', e.target.value)} /></Field>}
        <Field id="reason" label="What is the reason for the visit?" hint="Your own words are fine. You can add more detail later." error={err.reason}>
          <textarea id="reason" className="input" rows={3} value={f.reason} onChange={(e: any) => set('reason', e.target.value)} placeholder="For example, headaches in the afternoon" aria-invalid={!!err.reason} />
        </Field>
      </div>}
      {step === 1 && <div className="stack-lg">
        <Field id="provider" label="Do you have a preferred provider?" optional hint="A doctor's name or a clinic.">
          <input id="provider" className="input" value={f.provider} onChange={(e: any) => set('provider', e.target.value)} placeholder="For example, Dr. Lee" />
        </Field>
        <button className="btn btn-ghost" onClick={() => setFinder(true)}><Icon name="search" size={18} />Help me find a provider</button>
        <fieldset className="field"><legend className="lbl">In person or virtual?</legend>
          <div className="stack">
            <Choice on={f.mode === 'in-person'} onClick={() => set('mode', 'in-person')} icon="pin" title="In person" desc="Go to the office" />
            <Choice on={f.mode === 'virtual'} onClick={() => set('mode', 'virtual')} icon="video" title="Virtual" desc="Video or phone from home" />
          </div>
        </fieldset>
      </div>}
      {step === 2 && <div className="stack-lg">
        <Field id="date" label="Preferred date" error={err.date}><input id="date" type="date" className="input" min={todayISO()} value={f.date} onChange={(e: any) => set('date', e.target.value)} aria-invalid={!!err.date} /></Field>
        <Field id="time" label="Preferred time" error={err.time}>
          <div className="chips">{[['09:00', 'Morning'], ['12:30', 'Midday'], ['15:30', 'Afternoon']].map(([t, l]) => <Chip key={t} on={f.time === t} onClick={() => set('time', t)}>{l} ({fmtTime(t)})</Chip>)}</div>
          <input id="time" type="time" className="input" value={f.time} onChange={(e: any) => set('time', e.target.value)} aria-label="Exact time" aria-invalid={!!err.time} />
        </Field>
      </div>}
      {step === 3 && <div className="stack-lg">
        <fieldset className="field"><legend className="lbl">Anything that would make the visit easier?</legend>
          <p className="hint">Optional. You can share these with the office.</p>
          <div className="chips">{ACCOMS.map(a => <Chip key={a} on={f.accom.includes(a)} onClick={() => set('accom', f.accom.includes(a) ? f.accom.filter((x: string) => x !== a) : [...f.accom, a])}>{a}</Chip>)}</div>
        </fieldset>
        <Field id="accomNote" label="Anything else?" optional><textarea id="accomNote" className="input" rows={2} value={f.accomNote} onChange={(e: any) => set('accomNote', e.target.value)} placeholder="For example, I communicate better in writing" /></Field>
      </div>}
      {step === 4 && <div className="stack-lg">
        <div className="card review">
          <strong>{f.kind === 'Other' ? f.kindOther : f.kind}</strong>
          <span>{f.reason}</span>
          <span className="muted">{fmtLong(f.date)}, {fmtTime(f.time)} · {f.mode === 'virtual' ? 'Virtual' : 'In person'}{f.provider ? ` · ${f.provider}` : ''}</span>
        </div>
        <fieldset className="field"><legend className="lbl">How do you want to continue?</legend>
          <div className="stack">
            <Choice on={f.path === 'find'} onClick={() => set('path', 'find')} icon="search" title="Help me find a provider" desc="See example providers" />
            <Choice on={f.path === 'call'} onClick={() => set('path', 'call')} icon="phone" title="Help me make the appointment" desc="Get a script to read when you call" />
            <Choice on={f.path === 'booked'} onClick={() => set('path', 'booked')} icon="check" title="I already booked it" desc="Just save it to my calendar" />
          </div>
          {err.path && <p className="err" role="alert"><Icon name="alert" size={16} />{err.path}</p>}
        </fieldset>
      </div>}
      <div className="form-actions">
        {step > 0 && <button className="btn btn-secondary" onClick={() => setStep(step - 1)}>Back</button>}
        {step < 4 ? <button className="btn btn-primary grow" onClick={next}>Continue</button> : <button className="btn btn-primary grow" onClick={save}>{f.path === 'booked' ? 'Save appointment' : 'Save plan'}</button>}
      </div>
      {finder && <Sheet title="Find a provider" onClose={() => setFinder(false)}>
        <div className="notice"><Icon name="info" size={18} /><span>These are made-up examples. Live provider search and availability need a future connection to provider directories and scheduling systems.</span></div>
        <div className="stack" style={{ marginTop: 12 }}>
          {SAMPLE_PROVIDERS.map(pr => (
            <button key={pr.name} className="provider" onClick={() => { set('provider', pr.name); if (f.path === 'find') set('path', 'call'); setFinder(false); toast(`${pr.name} added as your preferred provider.`); }}>
              <Avatar name={pr.name} size={44} />
              <span className="row-text"><strong>{pr.name} <Sim>Example</Sim></strong><span>{pr.kind} · {pr.mode}</span><span className="muted">{pr.where}</span><span className="tag-line"><Icon name="check" size={14} />{pr.note}</span></span>
            </button>
          ))}
        </div>
      </Sheet>}
    </Screen>
  );
}

export function ApptSaved({ p }: any) {
  const { s, nav } = useApp();
  const a = s.appointments.find((x: any) => x.id === p.id);
  if (!a) return <Screen title="Appointment not found"><Empty icon="cal" title="This appointment was removed." /></Screen>;
  const booked = a.status === 'booked';
  return (
    <Screen title={booked ? 'Saved to your calendar' : 'Your plan is saved'} label="Health" back={false}>
      <div className="success-mark"><Icon name="check" size={32} /></div>
      <ApptCard a={a} onClick={() => nav.push('appt', { id: a.id })} />
      <div className="notice warn" style={{ marginTop: 14 }}><Icon name="info" size={18} /><span>{booked ? 'Rumi did not contact the office. Make sure they have confirmed this time with you.' : 'This appointment is not booked yet. Call the office to book it. Rumi made you a script.'}</span></div>
      <div className="stack" style={{ marginTop: 20 }}>
        {!booked && <button className="btn btn-primary" onClick={() => nav.replace('callScript', { id: a.id })}><Icon name="phone" size={18} />Open my call script</button>}
        <button className={booked ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => nav.replace('prep', { apptId: a.id })}><Icon name="notes" size={18} />Prepare for this visit</button>
        <button className="btn btn-ghost" onClick={() => nav.reset('health')}>Back to Health</button>
      </div>
    </Screen>
  );
}

export function CallScript({ p }: any) {
  const { s, nav, update, toast, speak } = useApp();
  const a = s.appointments.find((x: any) => x.id === p.id) || {};
  const [text, setText] = useState(() => callScript(a, s.profile.name));
  const ref = useRef(null);
  return (
    <Screen title="Your call script" sub="Read it as written, or change anything first." label="Make the appointment">
      <div className="script-card">
        <label className="lbl" htmlFor="script">What to say</label>
        <textarea id="script" ref={ref} className="input script" rows={9} value={text} onChange={(e: any) => setText(e.target.value)} />
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={() => copyText(text, toast, ref.current)}><Icon name="copy" size={18} />Copy</button>
          <ReadAloud text={text} />
        </div>
      </div>
      <section className="section">
        <h2>If you get stuck</h2>
        <ul className="tips">
          <li>"Sorry, could you say that again more slowly?"</li>
          <li>"Can I check my calendar and call you back?"</li>
          <li>"Could you send that to me in writing?"</li>
        </ul>
      </section>
      {a.status === 'planned' && <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => { update((d: any) => { const x = d.appointments.find((y: any) => y.id === a.id); if (x) x.status = 'booked'; }); toast('Marked as booked by you.'); nav.replace('appt', { id: a.id }); }}><Icon name="check" size={18} />I called and booked it</button>}
    </Screen>
  );
}

export function ApptDetail({ p }: any) {
  const { s, nav, update, toast } = useApp();
  const [confirm, setConfirm] = useState(false);
  const a = s.appointments.find((x: any) => x.id === p.id);
  if (!a) return <Screen title="Appointment removed"><Empty icon="cal" title="This appointment is no longer here." action={<button className="btn btn-secondary" onClick={() => nav.reset('health')}>Back to Health</button>} /></Screen>;
  const prep = s.prep[a.id];
  return (
    <Screen title={a.kind} sub={a.reason} label="Appointment">
      <div className="detail-grid card">
        <div><span className="lbl-sm">When</span><strong>{fmtLong(a.date)}</strong><span>{fmtTime(a.time)} · {relDay(a.date)}</span></div>
        <div><span className="lbl-sm">Where</span><strong>{a.mode === 'virtual' ? 'Virtual visit' : 'In person'}</strong><span>{a.provider || 'No provider added'}</span></div>
        <div><span className="lbl-sm">Status</span>{a.status === 'planned' ? <span className="pill pill-warn"><Icon name="phone" size={14} />Not booked yet</span> : <span className="pill pill-ok"><Icon name="check" size={14} />Added by you</span>}{a.sample && <Sim>Sample</Sim>}</div>
        {(a.accom.length > 0 || a.accomNote) && <div className="span2"><span className="lbl-sm">Comfort requests</span><div className="chips static">{a.accom.map((x: string) => <span key={x} className="chip-static">{x}</span>)}</div>{a.accomNote && <span>{a.accomNote}</span>}</div>}
      </div>
      <div className="stack" style={{ marginTop: 18 }}>
        <Row icon="notes" tone="lav" title={prep ? 'Your preparation card' : 'Prepare for this visit'} desc={prep ? 'Saved. Tap to view or edit.' : 'Write down what you want to say'} onClick={() => nav.push('prep', { apptId: a.id })} />
        <Row icon="video" tone="sage" title="Practice this visit" desc="Talk with a practice doctor" onClick={() => nav.push('practiceSetup', { apptId: a.id })} />
        <Row icon="phone" tone="blue" title="Call script" desc="What to say to the office" onClick={() => nav.push('callScript', { id: a.id })} />
        <Row icon="rescue" tone="apricot" title="This appointment changed" desc="Work through it step by step" onClick={() => nav.push('rescueAppt', { id: a.id }, 'rescue')} />
      </div>
      <div className="danger-zone">
        {!confirm ? <button className="btn btn-ghost danger" onClick={() => setConfirm(true)}><Icon name="trash" size={18} />Delete appointment</button>
          : <div className="confirm-box" role="group" aria-label="Confirm delete"><p>Delete this appointment and its notes?</p><div className="btn-row"><button className="btn btn-secondary" onClick={() => setConfirm(false)}>Keep it</button><button className="btn btn-danger" onClick={() => { update((d: any) => { d.appointments = d.appointments.filter((x: any) => x.id !== a.id); delete d.prep[a.id]; }); toast('Appointment deleted.'); nav.back(); }}>Delete</button></div></div>}
      </div>
    </Screen>
  );
}

// ---------- Preparation ----------
function ListEditor({ id, items, onChange, placeholder }: any) {
  const [draft, setDraft] = useState('');
  const add = () => { if (!draft.trim()) return; onChange([...items, draft.trim()]); setDraft(''); };
  return (
    <div className="list-editor">
      {items.length === 0 && <p className="hint">Nothing here yet.</p>}
      {items.map((it: string, i: number) => (
        <div className="le-row" key={i}>
          <input className="input" aria-label={`Item ${i + 1}`} value={it} onChange={(e: any) => { const n = [...items]; n[i] = e.target.value; onChange(n); }} />
          <button className="icon-btn" aria-label={`Remove item ${i + 1}`} onClick={() => onChange(items.filter((_: any, j: number) => j !== i))}><Icon name="x" size={18} /></button>
        </div>
      ))}
      <div className="le-row">
        <input id={id} className="input" value={draft} placeholder={placeholder} onChange={(e: any) => setDraft(e.target.value)} onKeyDown={(e: any) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button className="icon-btn filled" aria-label="Add item" onClick={add}><Icon name="plus" size={18} /></button>
      </div>
    </div>
  );
}
const PREP_SECTIONS = [
  { key: 'symptoms', title: 'Symptoms or concerns', ph: 'Add a symptom or concern' },
  { key: 'questions', title: 'My questions', ph: 'Add a question' },
  { key: 'nervous', title: "Things I'm nervous about", ph: 'Add something' },
  { key: 'accom', title: 'Accommodation requests', ph: 'Add a request' },
  { key: 'other', title: 'Other notes', ph: 'Add a note' },
];
export const emptyPrep = (a?: any) => ({ reason: a ? a.reason : '', symptoms: [], questions: [], nervous: [], accom: a ? [...a.accom] : [], other: [], dump: '' });

export function PrepScreen({ p }: any) {
  const { s, nav, update, toast } = useApp();
  const [apptId, setApptId] = useState(p.apptId || 'general');
  const a = s.appointments.find((x: any) => x.id === apptId);
  const [prep, setPrep] = useState(() => s.prep[apptId] || emptyPrep(a));
  const [organized, setOrganized] = useState(null as any);
  const [view, setView] = useState(s.prep[apptId] && s.prep[apptId].saved ? 'card' : 'edit');
  useEffect(() => { const ex = s.prep[apptId]; setPrep(ex || emptyPrep(s.appointments.find((x: any) => x.id === apptId))); setView(ex && ex.saved ? 'card' : 'edit'); setOrganized(null); }, [apptId]);
  const set = (k: string, v: any) => setPrep((x: any) => ({ ...x, [k]: v }));
  const organize = () => {
    if (!prep.dump.trim()) { toast('Write a few notes first, then tap Help Me Organize.'); return; }
    const o: any = organizeNotes(prep.dump);
    const merged: any = { ...prep };
    let count = 0;
    Object.keys(o).forEach(k => { o[k].forEach((item: string) => { if (!merged[k].includes(item)) { merged[k] = [...merged[k], item]; count++; } }); });
    merged.dump = '';
    setPrep(merged); setOrganized(count);
  };
  const save = () => {
    const firstTime = !(s.prep[apptId] && s.prep[apptId].saved);
    update((d: any) => { d.prep[apptId] = { ...prep, saved: todayISO() }; if (firstTime) addGrowth(d, 'prep', `Prepared for ${a ? a.kind.toLowerCase() + ' visit' : 'an appointment'}`); });
    setView('card'); toast('Preparation card saved.');
    const v = document.querySelector('.viewport'); v && v.scrollTo(0, 0);
  };
  const appts = s.appointments;
  return (
    <Screen title={view === 'card' ? 'Your preparation card' : 'Prepare for your visit'} sub={view === 'card' ? 'Bring this with you, or read from it during the visit.' : 'Write what you want to remember. Rumi can sort it for you.'} label="Prepare">
      {appts.length > 0 && <div className="chips scroll-x" role="group" aria-label="Which appointment">
        {appts.map((x: any) => <Chip key={x.id} on={apptId === x.id} onClick={() => setApptId(x.id)}>{x.kind} · {fmtDate(x.date)}</Chip>)}
        <Chip on={apptId === 'general'} onClick={() => setApptId('general')}>Not linked</Chip>
      </div>}
      {view === 'card' ? (
        <div className="prep-card">
          <div className="prep-head"><span className="lbl-sm">Main reason for visit</span><strong>{prep.reason || 'Not added yet'}</strong>{a && <span className="muted">{a.kind} · {fmtLong(a.date)}, {fmtTime(a.time)}</span>}</div>
          {PREP_SECTIONS.map(sec => prep[sec.key].length > 0 && (
            <div className="prep-sec" key={sec.key}><h3>{sec.title}</h3><ul>{prep[sec.key].map((it: string, i: number) => <li key={i}>{it}</li>)}</ul></div>
          ))}
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => setView('edit')}><Icon name="edit" size={18} />Edit</button>
            <ReadAloud text={[prep.reason, ...PREP_SECTIONS.flatMap(sec => prep[sec.key].length ? [sec.title, ...prep[sec.key]] : [])].join('. ')} />
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12, width: '100%' }} onClick={() => nav.push('practiceSetup', { apptId: apptId === 'general' ? undefined : apptId })}><Icon name="video" size={18} />Practice this visit</button>
        </div>
      ) : (
        <div className="stack-lg">
          <Field id="preason" label="Main reason for visit"><input id="preason" className="input" value={prep.reason} onChange={(e: any) => set('reason', e.target.value)} placeholder="For example, afternoon headaches" /></Field>
          <div className="organize card bg-lav-soft">
            <Field id="dump" label="Write it all out" hint="Any order, any length. Symptoms, questions, worries, requests.">
              <textarea id="dump" className="input" rows={5} value={prep.dump} onChange={(e: any) => set('dump', e.target.value)} placeholder={'Headaches start around 3pm and last a few hours.\nI get nervous when they take blood.\nCan I get the instructions in writing?\nI need a quiet room if possible.'} />
            </Field>
            <button className="btn btn-primary" onClick={organize}><Icon name="sparkle" size={18} />Help Me Organize</button>
            <p className="hint small">Sorted on your device with simple rules. Rumi only moves your words into sections. It never adds new ones.</p>
            {organized !== null && <p className="ok-line" role="status"><Icon name="check" size={16} />{organized} {organized === 1 ? 'note' : 'notes'} sorted into sections below. Check them and edit anything.</p>}
          </div>
          {PREP_SECTIONS.map(sec => (
            <fieldset className="field" key={sec.key}><legend className="lbl">{sec.title}</legend><ListEditor id={'add-' + sec.key} items={prep[sec.key]} onChange={(v: any) => set(sec.key, v)} placeholder={sec.ph} /></fieldset>
          ))}
          <button className="btn btn-primary" onClick={save}><Icon name="check" size={18} />Save preparation card</button>
        </div>
      )}
    </Screen>
  );
}

// ---------- Practice ----------
export function PracticeSetup({ p }: any) {
  const { s, nav } = useApp();
  const [sc, setSc] = useState(() => { const a = s.appointments.find((x: any) => x.id === p.apptId); return a && a.kind === 'Dentist' ? 'dentist' : a && /therapy|counsel/i.test(a.kind) ? 'therapy' : 'general'; });
  const [apptId, setApptId] = useState(p.apptId || '');
  return (
    <Screen title="Practice a visit" sub="Talk with a practice doctor. Pause, repeat, or stop any time." label="Practice">
      <div className="notice"><Icon name="info" size={18} /><span>This is a communication practice with simulated responses. It is not a medical consultation.</span></div>
      <fieldset className="field" style={{ marginTop: 16 }}><legend className="lbl">What kind of visit?</legend>
        <div className="stack">{Object.entries(SCENARIOS).map(([k, v]) => <Choice key={k} on={sc === k} onClick={() => setSc(k)} icon={v.icon} title={v.title} desc={v.desc} />)}</div>
      </fieldset>
      {s.appointments.length > 0 && <fieldset className="field"><legend className="lbl">Use notes from an appointment?</legend>
        <div className="chips">{s.appointments.map((a: any) => <Chip key={a.id} on={apptId === a.id} onClick={() => setApptId(apptId === a.id ? '' : a.id)}>{a.kind} · {fmtDate(a.date)}</Chip>)}</div>
      </fieldset>}
      <button className="btn btn-primary big" onClick={() => nav.push('practice', { sc, apptId })}><Icon name="video" size={20} />Start practice</button>
    </Screen>
  );
}

function DoctorAvatar({ speaking, who }: any) {
  const hair = who === 'Dr. Patel' ? '#2B2230' : who === 'Alex' ? '#6B4A33' : '#3A2C2A';
  const skin = who === 'Dr. Patel' ? '#C9946F' : who === 'Alex' ? '#E8BF9C' : '#D9A884';
  return (
    <svg viewBox="0 0 200 200" className={'doc-av' + (speaking ? ' speaking' : '')} aria-hidden="true">
      <circle cx="100" cy="100" r="96" fill="#3A3650" />
      <circle cx="100" cy="100" r="96" fill="none" stroke="#BBAAE8" strokeWidth="4" className="speak-ring" />
      <path d="M38 196c6-38 30-56 62-56s56 18 62 56Z" fill="#F4F2F8" />
      <path d="M84 142l16 22 16-22" fill="#DCEAF4" />
      <path d="M70 150c-4 18 2 30 14 32" stroke="#66558D" strokeWidth="4" fill="none" strokeLinecap="round" />
      <rect x="90" y="118" width="20" height="26" rx="8" fill={skin} />
      <ellipse cx="100" cy="92" rx="32" ry="37" fill={skin} />
      <path d={who === 'Alex' ? 'M66 88c0-26 14-40 34-40s34 14 34 40c-6-12-18-20-34-20s-28 8-34 20Z' : 'M66 92c-4-30 12-46 34-46 24 0 40 16 34 46-4-14-16-26-34-26-16 0-28 10-34 26Z'} fill={hair} />
      <circle cx="88" cy="94" r="3.4" fill="#2A2733" />
      <circle cx="112" cy="94" r="3.4" fill="#2A2733" />
      <path d="M86 84c3-2 7-2 9 0M105 84c3-2 7-2 9 0" stroke="#2A2733" strokeWidth="2" strokeLinecap="round" fill="none" />
      <ellipse cx="100" cy="112" rx="7" ry="3" fill="#8A4B45" className="mouth" />
    </svg>
  );
}

export function Practice({ p }: any) {
  const { s, nav, update, toast, speak, reduced } = useApp();
  const scen = SCENARIOS[p.sc] || SCENARIOS.general;
  const prep = p.apptId ? s.prep[p.apptId] : null;
  const [msgs, setMsgs] = useState([] as any[]);
  const [node, setNode] = useState(scen.start);
  const [thinking, setThinking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [input, setInput] = useState('');
  const [sheet, setSheet] = useState('');
  const [voice, setVoice] = useState(false);
  const [listening, setListening] = useState(false);
  const [crisis, setCrisis] = useState(false);
  const [error, setError] = useState('');
  const answers = useRef([] as any[]);
  const recRef = useRef(null as any);
  const logRef = useRef(null as any);
  const voiceRef = useRef(false);
  voiceRef.current = voice;
  const done = !!(scen.nodes[node] && scen.nodes[node].end);

  const ask = (id: string) => {
    setThinking(true);
    setTimeout(() => {
      setNode(id); setThinking(false);
      setMsgs((m: any[]) => [...m, { from: 'doc', text: scen.nodes[id].q, id: uid() }]);
      if (voiceRef.current) speak(scen.nodes[id].q);
    }, reduced ? 250 : 900);
  };
  useEffect(() => { ask(scen.start); return () => { try { recRef.current && recRef.current.stop(); window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { } }; }, []);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, thinking]);

  const send = () => {
    if (paused || thinking || done) return;
    if (!input.trim()) { setError('Type an answer first, or tap Help me say it.'); return; }
    const text = input.trim();
    if (isCrisis(text)) setCrisis(true);
    const cur = scen.nodes[node];
    answers.current.push({ q: cur.q, a: text, topic: cur.topic });
    setMsgs((m: any[]) => [...m, { from: 'me', text, id: uid() }]);
    setInput(''); setError('');
    const nxt = cur.next ? cur.next(text) : 'end';
    ask(nxt);
  };
  const repeat = () => { const q = scen.nodes[node].q; setMsgs((m: any[]) => [...m, { from: 'doc', text: q, id: uid(), repeat: true }]); speak(q); };
  const mic = () => {
    if (listening) { try { recRef.current && recRef.current.stop(); } catch (e) { } setListening(false); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast("Voice input isn't supported here. Typing works the same way."); return; }
    try {
      const r = new SR(); r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
      r.onresult = (e: any) => { const t = e.results[0][0].transcript; setInput((x: string) => (x ? x + ' ' : '') + t); };
      r.onerror = (e: any) => { setListening(false); toast(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone access is off for this page. You can type instead.' : 'Voice input stopped. You can type instead.'); };
      r.onend = () => setListening(false);
      recRef.current = r; r.start(); setListening(true);
    } catch (e) { setListening(false); toast("Voice input isn't available here. Typing works the same way."); }
  };
  const end = () => {
    try { recRef.current && recRef.current.stop(); window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { }
    const ans = answers.current;
    if (ans.length > 0) update((d: any) => addGrowth(d, 'practice', `Practiced a ${scen.title.toLowerCase()}`));
    nav.replace('recap', { sc: p.sc, apptId: p.apptId, answers: ans });
  };
  const cur = scen.nodes[node];
  const me = s.profile.name || 'You';

  return (
    <div className="call" role="region" aria-label="Practice visit">
      <div className="call-top">
        <div><span className="call-title">{scen.title}</span><span className="call-sub"><span className="live-dot" aria-hidden="true" />Practice session · Simulated</span></div>
        <button className="call-chip" aria-pressed={voice} onClick={() => { setVoice(!voice); if (!voice) toast('Questions will be read aloud.'); }}><Icon name="volume" size={16} />{voice ? 'Voice on' : 'Voice off'}</button>
      </div>
      <div className="call-stage">
        <DoctorAvatar speaking={thinking && !reduced} who={scen.who} />
        <div className="call-name"><strong>{scen.who}</strong><span>{scen.role} · practice avatar</span></div>
        <span className="call-status" aria-live="polite">{paused ? 'Paused' : thinking ? `${scen.who} is talking…` : done ? 'Practice finished' : 'Your turn'}</span>
        <div className="self-tile" aria-hidden="true"><span>{(me[0] || 'Y').toUpperCase()}</span><small>You</small></div>
      </div>
      <div className="call-log" ref={logRef} aria-live="polite" aria-label="Conversation transcript">
        {msgs.map((m: any) => <div key={m.id} className={'cbub ' + m.from}><span className="cbub-who">{m.from === 'doc' ? scen.who : 'You'}{m.repeat ? ' (repeated)' : ''}</span>{m.text}</div>)}
        {thinking && <div className="cbub doc typing"><span className="cbub-who">{scen.who}</span><span className="dots" aria-label="typing"><i /><i /><i /></span></div>}
      </div>
      {crisis && <div className="call-crisis" role="alert"><Icon name="alert" size={18} /><span>This is a practice space and can't help in a crisis. If you might hurt yourself, call or text 988 in the US, or call your local emergency number.</span><button className="icon-btn" aria-label="Close message" onClick={() => setCrisis(false)}><Icon name="x" size={16} /></button></div>}
      <div className="call-compose">
        {error && <p className="call-err" role="alert">{error}</p>}
        {!done ? <div className="compose-row">
          <button className={'round-btn' + (listening ? ' on' : '')} onClick={mic} aria-pressed={listening} aria-label={listening ? 'Stop voice input' : 'Speak your answer'}><Icon name="mic" size={20} /></button>
          <label className="sr-only" htmlFor="pans">Your answer</label>
          <input id="pans" className="call-input" value={input} disabled={paused} onChange={(e: any) => { setInput(e.target.value); setError(''); }} onKeyDown={(e: any) => { if (e.key === 'Enter') send(); }} placeholder={listening ? 'Listening… tap the mic to stop' : 'Type your answer'} />
          <button className="round-btn send" onClick={send} aria-label="Send answer" disabled={paused || thinking}><Icon name="send" size={20} /></button>
        </div> : <button className="btn btn-primary big" onClick={end}>See my recap</button>}
      </div>
      <div className="call-controls" role="toolbar" aria-label="Practice controls">
        <button onClick={() => setPaused(!paused)} aria-pressed={paused}><Icon name={paused ? 'play' : 'pause'} /><span>{paused ? 'Resume' : 'Pause'}</span></button>
        <button onClick={repeat} disabled={thinking || paused}><Icon name="repeat" /><span>Repeat</span></button>
        <button onClick={() => setSheet('say')} disabled={done}><Icon name="bubble" /><span>Help me say it</span></button>
        <button onClick={() => setSheet('notes')}><Icon name="notes" /><span>My notes</span></button>
        <button className="end" onClick={end}><Icon name="end" /><span>End</span></button>
      </div>
      {paused && <div className="pause-overlay"><div><strong>Paused</strong><p>Take the time you need. Nothing moves on until you're ready.</p><button className="btn btn-primary" onClick={() => setPaused(false)}><Icon name="play" size={18} />Resume</button></div></div>}
      {sheet === 'say' && <Sheet title="Help me say it" onClose={() => setSheet('')}>
        <p className="hint">Tap one to put it in your answer. You can change it before sending.</p>
        <p className="quote-q">{cur.q}</p>
        <div className="stack">{cur.say.map((t: string) => <button key={t} className="say-opt" onClick={() => { setInput(t); setSheet(''); setTimeout(() => { const el = document.getElementById('pans'); el && el.focus(); }, 50); }}>{t}</button>)}</div>
        <p className="hint small" style={{ marginTop: 12 }}>Example phrases are written by the Rumi team. They are suggestions, not the right answer.</p>
      </Sheet>}
      {sheet === 'notes' && <Sheet title="My notes" onClose={() => setSheet('')}>
        {prep ? <div className="prep-card compact">
          <div className="prep-head"><span className="lbl-sm">Main reason</span><strong>{prep.reason || 'Not added'}</strong></div>
          {PREP_SECTIONS.map(sec => prep[sec.key].length > 0 && <div className="prep-sec" key={sec.key}><h3>{sec.title}</h3><ul>{prep[sec.key].map((it: string, i: number) => <li key={i}>{it}</li>)}</ul></div>)}
        </div> : <Empty icon="notes" title="No notes linked" body="Prepare for an appointment first, then pick it before you start practicing." />}
      </Sheet>}
    </div>
  );
}

export function Recap({ p }: any) {
  const { s, nav, update, toast } = useApp();
  const scen = SCENARIOS[p.sc] || SCENARIOS.general;
  const answers = p.answers || [];
  const topics = Array.from(new Set(answers.map((a: any) => a.topic).filter(Boolean)));
  const [refl, setRefl] = useState('');
  return (
    <Screen title="Practice recap" sub={scen.title} label="Practice" back={false}>
      {answers.length === 0 ? <Empty icon="bubble" title="You ended before answering" body="That's fine. You can try again whenever you like." /> : <>
        <div className="stat-row">
          <div className="stat"><strong>{answers.length}</strong><span>{answers.length === 1 ? 'question answered' : 'questions answered'}</span></div>
          <div className="stat"><strong>{topics.length}</strong><span>{topics.length === 1 ? 'topic covered' : 'topics covered'}</span></div>
        </div>
        <section className="section"><h2>Topics you practiced</h2><div className="chips static">{topics.map((t: any) => <span key={t} className="chip-static"><Icon name="check" size={14} />{t}</span>)}</div></section>
        <section className="section"><h2>What you said</h2>
          <div className="stack">{answers.map((a: any, i: number) => <div key={i} className="qa"><span className="qa-q">{a.q}</span><span className="qa-a">{a.a}</span></div>)}</div>
        </section>
      </>}
      <section className="section">
        <Field id="refl" label="Anything you want to remember for next time?" optional hint="Only you can see this.">
          <textarea id="refl" className="input" rows={3} value={refl} onChange={(e: any) => setRefl(e.target.value)} placeholder="For example, ask for things in writing" />
        </Field>
        {refl.trim() && <button className="btn btn-secondary" onClick={() => { update((d: any) => d.reflections.unshift({ id: uid(), date: todayISO(), text: refl.trim() })); setRefl(''); toast('Saved to My Growth.'); }}>Save note</button>}
      </section>
      <p className="fineprint"><Icon name="info" size={14} />Practice helps with words and confidence. It can't tell whether you are medically ready for a visit, so there's no score.</p>
      <div className="form-actions">
        <button className="btn btn-secondary" onClick={() => nav.replace('practice', { sc: p.sc, apptId: p.apptId })}><Icon name="repeat" size={18} />Try again</button>
        <button className="btn btn-primary grow" onClick={() => nav.reset('health')}>Done</button>
      </div>
    </Screen>
  );
}

// ---------- Recording ----------
export function RecordScreen() {
  const { s, nav, update, toast } = useApp();
  const [phase, setPhase] = useState('intro'); // intro, ready, recording, paused, stopped
  const [consent, setConsent] = useState({ told: false, law: false });
  const [demo, setDemo] = useState(false);
  const [secs, setSecs] = useState(0);
  const [audioUrl, setAudioUrl] = useState('');
  const [err, setErr] = useState('');
  const mr = useRef(null as any); const chunks = useRef([] as any[]); const stream = useRef(null as any); const tick = useRef(null as any);
  useEffect(() => () => { clearInterval(tick.current); try { stream.current && stream.current.getTracks().forEach((t: any) => t.stop()); } catch (e) { } }, []);
  const startTimer = () => { clearInterval(tick.current); tick.current = setInterval(() => setSecs((x: number) => x + 1), 1000); };
  const start = async () => {
    setErr('');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof (window as any).MediaRecorder === 'undefined') throw new Error('unsupported');
      const st = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = st; chunks.current = [];
      const r = new (window as any).MediaRecorder(st); mr.current = r;
      r.ondataavailable = (e: any) => chunks.current.push(e.data);
      r.onstop = () => { const b = new Blob(chunks.current, { type: 'audio/webm' }); setAudioUrl(URL.createObjectURL(b)); st.getTracks().forEach((t: any) => t.stop()); };
      r.start(); setDemo(false); setSecs(0); setPhase('recording'); startTimer();
    } catch (e) {
      setErr("Recording isn't available on this page, so the microphone was not turned on. You can try a demo recording instead.");
    }
  };
  const startDemo = () => { setDemo(true); setErr(''); setSecs(0); setPhase('recording'); startTimer(); };
  const pause = () => { clearInterval(tick.current); try { mr.current && mr.current.state === 'recording' && mr.current.pause(); } catch (e) { } setPhase('paused'); };
  const resume = () => { try { mr.current && mr.current.state === 'paused' && mr.current.resume(); } catch (e) { } setPhase('recording'); startTimer(); };
  const stop = () => { clearInterval(tick.current); try { mr.current && mr.current.state !== 'inactive' && mr.current.stop(); } catch (e) { } setPhase('stopped'); };
  const discard = () => { setPhase('ready'); setSecs(0); setAudioUrl(''); toast('Recording deleted.'); };
  const save = () => { update((d: any) => d.recordings.unshift({ id: uid(), date: todayISO(), secs, demo })); toast('Recording saved on this device.'); setPhase('saved'); };
  const mmss = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <Screen title="Record an appointment" label="Health">
      {phase === 'intro' && <div className="stack-lg">
        <div className="card">
          <h2>Before you record</h2>
          <ul className="tips plain"><li>Everyone in the room needs to agree to being recorded. Ask at the start of the visit.</li><li>Recording laws differ by state and country. Some places require everyone's consent.</li><li>The microphone only turns on after you tap Start. You'll always see when it is on.</li></ul>
        </div>
        <fieldset className="field"><legend className="lbl">Please confirm</legend>
          <div className="stack">
            <Choice on={consent.told} onClick={() => setConsent({ ...consent, told: !consent.told })} title="I'll ask everyone in the room first" desc="Including the doctor or nurse" />
            <Choice on={consent.law} onClick={() => setConsent({ ...consent, law: !consent.law })} title="I understand recording laws vary" desc="I'm responsible for following them" />
          </div>
        </fieldset>
        <p className="hint">You can say "Is it okay if I record this so I can remember what we talk about?"</p>
        <button className="btn btn-primary" disabled={!(consent.told && consent.law)} onClick={() => setPhase('ready')}>Continue</button>
      </div>}
      {phase !== 'intro' && phase !== 'saved' && <div className="recorder">
        <div className={'rec-face ' + phase} aria-live="polite">
          <span className="rec-state">{phase === 'recording' ? <><span className="rec-dot" aria-hidden="true" />Recording{demo ? ' (demo)' : ''}</> : phase === 'paused' ? 'Paused' : phase === 'stopped' ? 'Stopped' : 'Ready'}</span>
          <span className="rec-time" aria-label={`Duration ${secs} seconds`}>{mmss}</span>
          {demo && <Sim>Demo, no audio captured</Sim>}
        </div>
        {err && <div className="notice warn"><Icon name="info" size={18} /><span>{err}</span></div>}
        {phase === 'ready' && <div className="stack"><button className="btn btn-primary big" onClick={start}><Icon name="rec" size={20} />Start recording</button>{err && <button className="btn btn-secondary" onClick={startDemo}>Try a demo recording</button>}</div>}
        {(phase === 'recording' || phase === 'paused') && <div className="btn-row center">
          {phase === 'recording' ? <button className="btn btn-secondary" onClick={pause}><Icon name="pause" size={18} />Pause</button> : <button className="btn btn-secondary" onClick={resume}><Icon name="play" size={18} />Resume</button>}
          <button className="btn btn-danger" onClick={stop}><Icon name="stop" size={18} />Stop</button>
        </div>}
        {phase === 'stopped' && <div className="stack">
          {audioUrl && <audio controls src={audioUrl} className="audio" />}
          <div className="btn-row"><button className="btn btn-secondary" onClick={discard}><Icon name="trash" size={18} />Delete</button><button className="btn btn-primary grow" onClick={save}><Icon name="check" size={18} />Save recording</button></div>
        </div>}
      </div>}
      {phase === 'saved' && <div className="stack-lg">
        <div className="success-mark"><Icon name="check" size={32} /></div>
        <p>Your recording is saved on this device. {demo ? 'Because this was a demo, Rumi can show you a summary using a sample transcript.' : 'Turning audio into a transcript needs a speech-to-text service that is not connected in this preview, so the summary uses a sample transcript.'}</p>
        <button className="btn btn-primary" onClick={() => nav.push('transcript')}>See a summary with the sample transcript</button>
        <button className="btn btn-ghost" onClick={() => setPhase('ready')}>Record another</button>
      </div>}
      {s.recordings.length > 0 && <section className="section"><h2>Saved recordings</h2>
        <div className="list">{s.recordings.map((r: any) => <div className="row static" key={r.id}><span className="row-ic bg-apricot"><Icon name="rec" size={18} /></span><span className="row-text"><strong>{fmtDate(r.date)}</strong><span>{Math.floor(r.secs / 60)}m {r.secs % 60}s{r.demo ? ' · demo' : ''}</span></span><button className="icon-btn" aria-label="Delete recording" onClick={() => { update((d: any) => { d.recordings = d.recordings.filter((x: any) => x.id !== r.id); }); toast('Recording deleted.'); }}><Icon name="trash" size={18} /></button></div>)}</div>
        <p className="hint small">Audio isn't kept after you close this preview. Only the list is saved.</p>
      </section>}
    </Screen>
  );
}

// ---------- Summaries ----------
export function Summaries() {
  const { s, nav } = useApp();
  return (
    <Screen title="Visit summaries" sub="A clear record of what was said, so you don't have to remember it all." label="Health">
      {s.summaries.length === 0 ? <Empty icon="notes" title="No summaries yet" body="See how it works using a sample visit." action={<button className="btn btn-primary" onClick={() => nav.push('transcript')}>Open sample transcript</button>} />
        : <><div className="list">{s.summaries.map((x: any) => <Row key={x.id} icon="notes" tone="blue" title={x.title} desc={`Saved ${fmtDate(x.date)}`} onClick={() => nav.push('summary', { id: x.id })} />)}</div>
          <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => nav.push('transcript')}>Open sample transcript</button></>}
    </Screen>
  );
}

export function Transcript() {
  const { nav, reduced } = useApp();
  const [loading, setLoading] = useState(false);
  const gen = () => { setLoading(true); setTimeout(() => { setLoading(false); nav.push('summary', { draft: true }); }, reduced ? 300 : 1400); };
  return (
    <Screen title="Sample transcript" sub={`${SAMPLE_TRANSCRIPT.title} · ${fmtDate(SAMPLE_TRANSCRIPT.date)}`} label="Visit summary">
      <div className="notice"><Icon name="info" size={18} /><span>This is a made-up visit used to show how summaries work. No real patient data.</span></div>
      <ol className="transcript">
        {SAMPLE_TRANSCRIPT.lines.map((l: any, i: number) => <li key={i} className={l.s === 'Doctor' ? 'doc' : 'pt'}><span className="ln">{i + 1}</span><span><strong>{l.s === 'Patient' ? 'Sam' : 'Dr. Lee'}</strong> {l.t}</span></li>)}
      </ol>
      <button className="btn btn-primary big sticky-cta" onClick={gen} disabled={loading} aria-busy={loading}>
        {loading ? <><span className="spinner" aria-hidden="true" />Organizing the transcript…</> : <><Icon name="sparkle" size={18} />Create summary</>}
      </button>
    </Screen>
  );
}

export function SummaryView({ p }: any) {
  const { s, nav, update, toast } = useApp();
  const existing = p.id ? s.summaries.find((x: any) => x.id === p.id) : null;
  const [sum, setSum] = useState(() => existing ? JSON.parse(JSON.stringify(existing)) : { id: uid(), title: SAMPLE_TRANSCRIPT.title, date: todayISO(), sections: summarizeTranscript(SAMPLE_TRANSCRIPT), source: 'sample' });
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const saved = !!s.summaries.find((x: any) => x.id === sum.id);
  if (p.id && !existing) return <Screen title="Summary removed"><Empty icon="notes" title="This summary was deleted." /></Screen>;
  const save = () => { update((d: any) => { const i = d.summaries.findIndex((x: any) => x.id === sum.id); if (i >= 0) d.summaries[i] = sum; else d.summaries.unshift(sum); }); setEditing(false); toast('Summary saved.'); };
  const setItem = (k: string, i: number, v: string) => setSum((x: any) => { const n = JSON.parse(JSON.stringify(x)); n.sections[k][i].text = v; return n; });
  return (
    <Screen title="Visit summary" sub={`${sum.title} · ${fmtDate(SAMPLE_TRANSCRIPT.date)}`} label="Visit summary">
      <div className="notice warn"><Icon name="alert" size={18} /><span>Simulated AI summary of a sample transcript. It may miss or misread things. Check anything important with your provider.</span></div>
      <div className="summary">
        {SUMMARY_SECTIONS.map(sec => (
          <section key={sec.key} className={'sum-sec' + (sec.key === 'clarify' ? ' clarify' : '')}>
            <h2><span className="sum-ic"><Icon name={sec.icon} size={18} /></span>{sec.title}</h2>
            {sum.sections[sec.key].length === 0 ? <p className="hint">Nothing mentioned.</p> :
              <ul>{sum.sections[sec.key].map((it: any, i: number) => <li key={i}>
                {editing ? <textarea className="input" rows={2} aria-label={`${sec.title} item ${i + 1}`} value={it.text} onChange={(e: any) => setItem(sec.key, i, e.target.value)} /> : <span>{it.text}</span>}
                {it.line && <span className="src">{sec.key === 'clarify' ? 'Suggested by Rumi from' : 'From'} transcript line {it.line}</span>}
              </li>)}</ul>}
          </section>
        ))}
      </div>
      <div className="btn-row wrap" style={{ marginTop: 16 }}>
        <button className="btn btn-secondary" onClick={() => setEditing(!editing)}><Icon name={editing ? 'check' : 'edit'} size={18} />{editing ? 'Done editing' : 'Edit notes'}</button>
        <button className="btn btn-primary grow" onClick={save}><Icon name="check" size={18} />{saved ? 'Save changes' : 'Save summary'}</button>
      </div>
      <div className="btn-row wrap" style={{ marginTop: 10 }}>
        <button className="btn btn-secondary grow" onClick={() => { if (!saved) save(); nav.push('share', { id: sum.id }); }}><Icon name="share" size={18} />Share with someone</button>
        {saved && (!confirm ? <button className="btn btn-ghost danger" onClick={() => setConfirm(true)}><Icon name="trash" size={18} />Delete</button>
          : <button className="btn btn-danger" onClick={() => { update((d: any) => { d.summaries = d.summaries.filter((x: any) => x.id !== sum.id); }); toast('Summary deleted.'); nav.back(); }}>Yes, delete</button>)}
      </div>
    </Screen>
  );
}

export function ShareScreen({ p }: any) {
  const { s, nav, toast } = useApp();
  const sum = s.summaries.find((x: any) => x.id === p.id);
  const [contact, setContact] = useState('');
  const [mode, setMode] = useState('all');
  const [secs, setSecs] = useState(['instructions', 'followup'] as string[]);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  if (!sum) return <Screen title="Share summary"><Empty icon="share" title="Save the summary first." /></Screen>;
  const c = s.contacts.find((x: any) => x.id === contact);
  const chosen = mode === 'all' ? SUMMARY_SECTIONS.map(x => x.key) : mode === 'some' ? secs : [];
  const preview = SUMMARY_SECTIONS.filter(x => chosen.includes(x.key) && sum.sections[x.key].length).map(x => `${x.title}\n${sum.sections[x.key].map((i: any) => '• ' + i.text).join('\n')}`).join('\n\n');
  const send = () => {
    if (mode === 'none') { toast('Nothing was shared.'); nav.back(); return; }
    if (!contact) { setErr('Choose who to share with.'); return; }
    if (!preview) { setErr('Pick at least one section that has notes.'); return; }
    setSent(true);
  };
  if (sent) return (
    <Screen title="Share preview complete" label="Share" back={false}>
      <div className="success-mark"><Icon name="check" size={32} /></div>
      <div className="notice warn"><Icon name="info" size={18} /><span>Simulated. Nothing was sent to {c.name}. Sending needs a secure, consent-based sharing service that isn't connected in this preview.</span></div>
      <button className="btn btn-primary" style={{ marginTop: 20, width: '100%' }} onClick={() => nav.reset('health')}>Back to Health</button>
    </Screen>
  );
  return (
    <Screen title="Share your summary" sub="You choose who sees it and exactly what they see." label="Share">
      <fieldset className="field"><legend className="lbl">Who do you want to share with?</legend>
        {s.contacts.length === 0 ? <Empty icon="you" title="No trusted contacts yet" action={<button className="btn btn-secondary" onClick={() => nav.push('contacts', {}, 'you')}>Add a trusted contact</button>} /> :
          <div className="stack">{s.contacts.map((x: any) => <Choice key={x.id} on={contact === x.id} onClick={() => { setContact(x.id); setErr(''); }} title={x.name} desc={x.relation} />)}</div>}
      </fieldset>
      <fieldset className="field"><legend className="lbl">What to share</legend>
        <div className="seg" role="group" aria-label="What to share">
          {[['all', 'Entire summary'], ['some', 'Selected sections'], ['none', 'Do not share']].map(([v, l]) => <button key={v} aria-pressed={mode === v} onClick={() => { setMode(v); setErr(''); }}>{l}</button>)}
        </div>
        {mode === 'some' && <div className="chips" style={{ marginTop: 10 }}>{SUMMARY_SECTIONS.map(x => <Chip key={x.key} on={secs.includes(x.key)} onClick={() => setSecs(secs.includes(x.key) ? secs.filter(k => k !== x.key) : [...secs, x.key])}>{x.title}</Chip>)}</div>}
      </fieldset>
      {mode !== 'none' && <section className="section"><h2>Exactly what {c ? c.name.replace(/\s*\(.*\)/, '') : 'they'} will see</h2><pre className="share-preview">{preview || 'Nothing selected.'}</pre></section>}
      {err && <p className="err" role="alert"><Icon name="alert" size={16} />{err}</p>}
      <button className="btn btn-primary big" onClick={send}>{mode === 'none' ? 'Done, keep it private' : 'Share (demo)'}</button>
    </Screen>
  );
}

export { PREP_SECTIONS };
