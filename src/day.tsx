import { useState, useApp, Screen, Icon, Field, Chip, Toggle, Empty, Sim, fmtLong, fmtTime, fmtDate, todayISO, uid, addGrowth, money, daysFromToday } from './core';
import { breakdown } from './data';
import { allEvents, groupById } from './circles';

export function MyDay() {
  const { s, nav, update, toast } = useApp();
  const today = todayISO();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: '', time: '', notes: '', remind: false });
  const [err, setErr] = useState('');
  const tasks = s.tasks.filter((t: any) => t.date <= today || !t.date);
  const open = tasks.filter((t: any) => !t.done); const done = tasks.filter((t: any) => t.done);
  const appts = s.appointments.filter((a: any) => a.date === today).map((a: any) => ({ time: a.time, title: `${a.kind} appointment`, kind: 'appt', id: a.id }));
  const evs = allEvents(s).filter((e: any) => e.date === today && s.rsvps[e.id] === 'going').map((e: any) => ({ time: e.time, title: e.title, kind: 'event', id: e.id }));
  const timed = tasks.filter((t: any) => t.time).map((t: any) => ({ time: t.time, title: t.title, kind: 'task', id: t.id, done: t.done }));
  const sched = [...appts, ...evs, ...timed].sort((a, b) => a.time.localeCompare(b.time));
  const add = () => {
    if (!f.title.trim()) { setErr('Give the task a name. A few words is fine.'); return; }
    const t = { id: uid(), title: f.title.trim(), date: today, time: f.time, notes: f.notes.trim(), done: false, remind: f.remind };
    update((d: any) => { d.tasks.push(t); });
    setF({ title: '', time: '', notes: '', remind: false }); setAdding(false); setErr('');
    toast(f.remind ? 'Task added. Reminders are simulated in this preview.' : 'Task added.');
  };
  const toggle = (t: any) => { update((d: any) => { const x = d.tasks.find((y: any) => y.id === t.id); x.done = !x.done; if (x.done) addGrowth(d, 'task', `Completed "${x.title}"`); }); toast(t.done ? 'Moved back to your list.' : 'Done. Nice.'); };
  return (
    <Screen title="My day" sub={fmtLong(today)} label="Home">
      <section className="section tight"><h2>Today's schedule</h2>
        {sched.length === 0 ? <p className="hint">Nothing with a set time today.</p> :
          <ol className="timeline">{sched.map((x, i) => <li key={i} className={x.done ? 'done' : ''}><span className="tl-time">{fmtTime(x.time)}</span><button className="tl-item" onClick={() => x.kind === 'appt' ? nav.push('appt', { id: x.id }, 'health') : x.kind === 'event' ? nav.push('event', { id: x.id }, 'circles') : nav.push('task', { id: x.id })}><span className={'tl-dot bg-' + (x.kind === 'appt' ? 'lav' : x.kind === 'event' ? 'sage' : 'blue')} /><span>{x.title}</span><span className="tl-kind">{x.kind === 'appt' ? 'Appointment' : x.kind === 'event' ? 'Meetup' : 'Task'}</span></button></li>)}</ol>}
      </section>
      <section className="section"><div className="section-head"><h2>Tasks</h2><span className="muted small">{open.length} to do</span></div>
        {open.length === 0 && !adding && <Empty icon="check" title="Nothing left on your list" body="Add something, or enjoy the space." />}
        <div className="task-list">{open.map((t: any) => <TaskRow key={t.id} t={t} onToggle={() => toggle(t)} />)}</div>
        {adding ? <div className="card add-task stack">
          <Field id="ttitle" label="What do you need to do?" error={err}><input id="ttitle" className="input" autoFocus value={f.title} onChange={(e: any) => { setF({ ...f, title: e.target.value }); setErr(''); }} onKeyDown={(e: any) => { if (e.key === 'Enter') add(); }} placeholder="For example, clean my room" /></Field>
          <Field id="ttime" label="Time" optional><input id="ttime" type="time" className="input" value={f.time} onChange={(e: any) => setF({ ...f, time: e.target.value })} /></Field>
          <Field id="tnotes" label="Notes" optional><input id="tnotes" className="input" value={f.notes} onChange={(e: any) => setF({ ...f, notes: e.target.value })} /></Field>
          <Toggle id="tremind" label="Remind me" desc="Simulated in this preview" on={f.remind} onChange={(v: boolean) => setF({ ...f, remind: v })} />
          <div className="btn-row"><button className="btn btn-secondary" onClick={() => { setAdding(false); setErr(''); }}>Cancel</button><button className="btn btn-primary grow" onClick={add}>Add task</button></div>
        </div> : <button className="btn btn-secondary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />Add task</button>}
        {done.length > 0 && <details className="done-list"><summary>Done today ({done.length})</summary><div className="task-list">{done.map((t: any) => <TaskRow key={t.id} t={t} onToggle={() => toggle(t)} />)}</div></details>}
      </section>
      <section className="section">
        <div className="grid2">
          <button className="tile bg-apricot" onClick={() => nav.push('startWithMe', {})}><Icon name="play" size={26} /><span><strong>Start With Me</strong><span>Break a task into small steps</span></span></button>
          <button className="tile bg-sage" onClick={() => nav.push('money')}><Icon name="wallet" size={26} /><span><strong>Money Mirror</strong><span>See what's left this week</span></span></button>
        </div>
      </section>
    </Screen>
  );
}

function TaskRow({ t, onToggle }: any) {
  const { nav } = useApp();
  return (
    <div className={'task' + (t.done ? ' done' : '')}>
      <button className="task-check" role="checkbox" aria-checked={t.done} aria-label={`${t.done ? 'Mark not done' : 'Mark done'}: ${t.title}`} onClick={onToggle}>{t.done && <Icon name="check" size={18} />}</button>
      <button className="task-main" onClick={() => nav.push('task', { id: t.id })}><strong>{t.title}</strong><span>{[t.time && fmtTime(t.time), t.remind && 'Reminder on', t.sample && 'Sample'].filter(Boolean).join(' · ') || 'Anytime today'}</span></button>
    </div>
  );
}
export { TaskRow };

export function TaskDetail({ p }: any) {
  const { s, nav, update, toast } = useApp();
  const t = s.tasks.find((x: any) => x.id === p.id);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(t ? { ...t } : {});
  if (!t) return <Screen title="Task removed"><Empty icon="list" title="This task was deleted." /></Screen>;
  return (
    <Screen title={t.title} label="Task">
      {!edit ? <div className="card detail-grid">
        <div><span className="lbl-sm">When</span><strong>{t.time ? fmtTime(t.time) : 'Anytime'}</strong><span>{fmtDate(t.date)}</span></div>
        <div><span className="lbl-sm">Status</span>{t.done ? <span className="pill pill-ok"><Icon name="check" size={14} />Done</span> : <span className="pill pill-neutral">To do</span>}</div>
        <div className="span2"><span className="lbl-sm">Notes</span><span>{t.notes || 'No notes.'}</span></div>
        <div className="span2"><span className="lbl-sm">Reminder</span><span>{t.remind ? 'On (simulated)' : 'Off'}</span></div>
      </div> : <div className="stack-lg">
        <Field id="et" label="Task"><input id="et" className="input" value={f.title} onChange={(e: any) => setF({ ...f, title: e.target.value })} /></Field>
        <Field id="etm" label="Time" optional><input id="etm" type="time" className="input" value={f.time} onChange={(e: any) => setF({ ...f, time: e.target.value })} /></Field>
        <Field id="en" label="Notes" optional><textarea id="en" className="input" rows={3} value={f.notes} onChange={(e: any) => setF({ ...f, notes: e.target.value })} /></Field>
        <Toggle id="erem" label="Remind me" desc="Simulated in this preview" on={f.remind} onChange={(v: boolean) => setF({ ...f, remind: v })} />
        <button className="btn btn-primary" onClick={() => { if (!f.title.trim()) { toast('The task needs a name.'); return; } update((d: any) => { const i = d.tasks.findIndex((x: any) => x.id === t.id); d.tasks[i] = { ...d.tasks[i], title: f.title.trim(), time: f.time, notes: f.notes, remind: f.remind }; }); setEdit(false); toast('Task updated.'); }}>Save changes</button>
      </div>}
      {!edit && <div className="stack" style={{ marginTop: 18 }}>
        {!t.done && <button className="btn btn-primary" onClick={() => nav.push('startWithMe', { taskId: t.id })}><Icon name="play" size={18} />Start With Me</button>}
        <button className="btn btn-secondary" onClick={() => { update((d: any) => { const x = d.tasks.find((y: any) => y.id === t.id); x.done = !x.done; if (x.done) addGrowth(d, 'task', `Completed "${x.title}"`); }); toast(t.done ? 'Moved back to your list.' : 'Marked done.'); }}><Icon name="check" size={18} />{t.done ? 'Mark not done' : 'Mark complete'}</button>
        <button className="btn btn-ghost" onClick={() => setEdit(true)}><Icon name="edit" size={18} />Edit</button>
        <button className="btn btn-ghost danger" onClick={() => { update((d: any) => { d.tasks = d.tasks.filter((x: any) => x.id !== t.id); }); toast('Task deleted.'); nav.back(); }}><Icon name="trash" size={18} />Delete task</button>
      </div>}
    </Screen>
  );
}

export function StartWithMe({ p }: any) {
  const { s, nav, update, toast, speak } = useApp();
  const task = p.taskId ? s.tasks.find((x: any) => x.id === p.taskId) : null;
  const [text, setText] = useState(task ? task.title : (p.text || ''));
  const [steps, setSteps] = useState(task ? breakdown(task.title) : null as any);
  const [i, setI] = useState(0);
  const [skipped, setSkipped] = useState([] as number[]);
  const [finished, setFinished] = useState(false);
  const [err, setErr] = useState('');
  const [pulse, setPulse] = useState(0);
  const begin = () => { if (!text.trim()) { setErr('Tell Rumi what you want to start.'); return; } setSteps(breakdown(text)); setI(0); };
  const finish = () => {
    update((d: any) => { if (task) { const x = d.tasks.find((y: any) => y.id === task.id); if (x && !x.done) { x.done = true; } } addGrowth(d, 'task', `Finished "${text}" with Start With Me`); });
    setFinished(true);
  };
  if (finished) return (
    <Screen title="You finished." label="Start With Me" back={false}>
      <div className="success-mark"><Icon name="check" size={32} /></div>
      <p className="big-p">"{text}" is done{skipped.length ? `, and you skipped ${skipped.length} ${skipped.length === 1 ? 'step' : 'steps'}. That's allowed.` : '.'}</p>
      <div className="stack"><button className="btn btn-primary" onClick={() => nav.reset('home')}>Back to Home</button><button className="btn btn-secondary" onClick={() => { setFinished(false); setSteps(null); setText(''); setSkipped([]); }}>Start something else</button></div>
    </Screen>
  );
  if (!steps) return (
    <Screen title="Start With Me" sub="Tell me the task. I'll break it into small steps, one at a time." label="My day">
      <Field id="swm" label="What do you need to start?" error={err}><input id="swm" className="input" value={text} onChange={(e: any) => { setText(e.target.value); setErr(''); }} onKeyDown={(e: any) => { if (e.key === 'Enter') begin(); }} placeholder="I need to clean my room" /></Field>
      <div className="chips" style={{ marginTop: 10 }}>{['Clean my room', 'Do laundry', 'Reply to an email', 'Go grocery shopping', 'Start my homework'].map(x => <Chip key={x} on={text === x} onClick={() => setText(x)}>{x}</Chip>)}</div>
      {s.tasks.filter((t: any) => !t.done).length > 0 && <section className="section"><h2>Or pick from today</h2><div className="chips">{s.tasks.filter((t: any) => !t.done).map((t: any) => <button key={t.id} className="chip" onClick={() => nav.replace('startWithMe', { taskId: t.id })}>{t.title}</button>)}</div></section>}
      <button className="btn btn-primary big" style={{ marginTop: 20 }} onClick={begin}>Break it down</button>
      <p className="fineprint"><Icon name="info" size={14} />Steps come from a built-in list in this preview. A connected AI could tailor them to you.</p>
    </Screen>
  );
  const last = i === steps.length - 1;
  return (
    <Screen title={text} label={`Start With Me · Step ${i + 1} of ${steps.length}`}>
      <div className="progress" aria-hidden="true"><span style={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>
      <div className={'swm-card' + (pulse ? ' pulse' : '')} key={i + '-' + pulse} aria-live="polite">
        <span className="lbl-sm">Step {i + 1}</span>
        <p className="swm-step">{steps[i]}</p>
        {skipped.includes(i) && <span className="pill pill-neutral">Skipped before</span>}
      </div>
      <div className="swm-actions">
        <button className="btn btn-primary big" onClick={() => last ? finish() : setI(i + 1)}>{last ? <><Icon name="check" size={20} />Finish</> : <>Next<Icon name="chev" size={20} /></>}</button>
        <div className="btn-row">
          <button className="btn btn-secondary grow" onClick={() => { setPulse(pulse + 1); if (s.settings.readAloud) speak(steps[i]); }}><Icon name="repeat" size={18} />Repeat</button>
          <button className="btn btn-secondary grow" onClick={() => { setSkipped([...skipped, i]); last ? finish() : setI(i + 1); }}>Skip</button>
        </div>
        {i > 0 && <button className="btn btn-ghost" onClick={() => setI(i - 1)}><Icon name="back" size={18} />Previous step</button>}
        {!last && <button className="btn btn-ghost" onClick={finish}>Finish now</button>}
      </div>
      <ol className="swm-all" aria-label="All steps">{steps.map((st: string, j: number) => <li key={j} className={j < i ? 'past' : j === i ? 'now' : ''}>{st}</li>)}</ol>
    </Screen>
  );
}

export function MoneyMirror() {
  const { s, update, toast } = useApp();
  const m = s.money;
  const [budget, setBudget] = useState(String(m.budget));
  const [buy, setBuy] = useState({ label: '', amount: '' });
  const [bill, setBill] = useState({ label: '', amount: '', day: '', recurring: true });
  const [err, setErr] = useState({} as any);
  const spent = m.purchases.reduce((a: number, x: any) => a + x.amount, 0);
  const left = m.budget - spent;
  const pct = m.budget > 0 ? Math.min(100, (spent / m.budget) * 100) : 0;
  const billsTotal = m.bills.reduce((a: number, x: any) => a + x.amount, 0);
  const tones = ['lav', 'sage', 'blue', 'apricot'];
  return (
    <Screen title="Money Mirror" sub="A simple view of your week. You enter the numbers." label="My day">
      <div className="notice"><Icon name="info" size={18} /><span>For learning and planning only. Not financial advice, and not connected to any bank.</span></div>
      <div className="money-hero card">
        <span className="lbl-sm">Left this week</span>
        <strong className={'money-big' + (left < 0 ? ' over' : '')}>{left < 0 ? '−' + money(-left) : money(left)}</strong>
        <span className="muted">{money(spent)} spent of {money(m.budget)}</span>
        <div className="bar" role="img" aria-label={`${Math.round(pct)} percent of weekly budget spent`}>
          {m.purchases.map((x: any, i: number) => <span key={x.id} className={'bg-' + tones[i % 4] + ' seg-fill'} style={{ width: `${m.budget > 0 ? Math.min(100, (x.amount / m.budget) * 100) : 0}%` }} title={`${x.label} ${money(x.amount)}`} />)}
        </div>
        {left < 0 && <p className="err"><Icon name="alert" size={16} />You're {money(-left)} over this week's budget.</p>}
      </div>
      <section className="section"><h2>Weekly budget</h2>
        <div className="le-row">
          <label className="sr-only" htmlFor="budget">Weekly budget in dollars</label>
          <span className="prefix">$</span><input id="budget" className="input" inputMode="decimal" value={budget} onChange={(e: any) => { setBudget(e.target.value); setErr({ ...err, budget: null }); }} />
          <button className="btn btn-secondary" onClick={() => { const v = parseFloat(budget); if (isNaN(v) || v < 0) { setErr({ ...err, budget: 'Enter a number, like 120.' }); return; } update((d: any) => { d.money.budget = v; }); toast('Budget updated.'); }}>Save</button>
        </div>
        {err.budget && <p className="err" role="alert"><Icon name="alert" size={16} />{err.budget}</p>}
      </section>
      <section className="section"><h2>Purchases this week</h2>
        <div className="list">{m.purchases.length === 0 ? <p className="hint">No purchases yet.</p> : m.purchases.map((x: any, i: number) => <div key={x.id} className="row static"><span className={'swatch bg-' + tones[i % 4]} aria-hidden="true" /><span className="row-text"><strong>{x.label}</strong>{x.sample && <span>Sample</span>}</span><span className="num">{money(x.amount)}</span><button className="icon-btn" aria-label={`Remove ${x.label}`} onClick={() => update((d: any) => { d.money.purchases = d.money.purchases.filter((y: any) => y.id !== x.id); })}><Icon name="x" size={18} /></button></div>)}</div>
        <div className="money-add">
          <input className="input" aria-label="What did you buy" placeholder="What did you buy?" value={buy.label} onChange={(e: any) => setBuy({ ...buy, label: e.target.value })} />
          <input className="input amt" aria-label="Amount in dollars" placeholder="0.00" inputMode="decimal" value={buy.amount} onChange={(e: any) => setBuy({ ...buy, amount: e.target.value })} />
          <button className="icon-btn filled" aria-label="Add purchase" onClick={() => { const v = parseFloat(buy.amount); if (!buy.label.trim() || isNaN(v) || v <= 0) { setErr({ ...err, buy: 'Add a name and an amount above zero.' }); return; } update((d: any) => { d.money.purchases.push({ id: uid(), label: buy.label.trim(), amount: v }); }); setBuy({ label: '', amount: '' }); setErr({ ...err, buy: null }); }}><Icon name="plus" size={18} /></button>
        </div>
        {err.buy && <p className="err" role="alert"><Icon name="alert" size={16} />{err.buy}</p>}
        {m.purchases.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => { update((d: any) => { d.money.purchases = []; }); toast('New week started.'); }}>Start a new week</button>}
      </section>
      <section className="section"><div className="section-head"><h2>Upcoming bills</h2><span className="muted small">{money(billsTotal)} a month</span></div>
        <div className="list">{m.bills.map((x: any) => <div key={x.id} className="row static"><span className="row-ic bg-blue"><Icon name="cal" size={18} /></span><span className="row-text"><strong>{x.label}</strong><span>Due on day {x.day}{x.recurring ? ' · repeats monthly' : ''}{x.sample ? ' · sample' : ''}</span></span><span className="num">{money(x.amount)}</span><button className="icon-btn" aria-label={`Remove ${x.label}`} onClick={() => update((d: any) => { d.money.bills = d.money.bills.filter((y: any) => y.id !== x.id); })}><Icon name="x" size={18} /></button></div>)}</div>
        <div className="card stack" style={{ marginTop: 10 }}>
          <div className="grid2"><Field id="bl" label="Bill"><input id="bl" className="input" value={bill.label} onChange={(e: any) => setBill({ ...bill, label: e.target.value })} placeholder="Internet" /></Field>
            <Field id="ba" label="Amount"><input id="ba" className="input" inputMode="decimal" value={bill.amount} onChange={(e: any) => setBill({ ...bill, amount: e.target.value })} placeholder="40" /></Field></div>
          <Field id="bd" label="Day of the month it's due"><input id="bd" className="input" inputMode="numeric" value={bill.day} onChange={(e: any) => setBill({ ...bill, day: e.target.value })} placeholder="15" /></Field>
          <Toggle id="brec" label="Repeats every month" on={bill.recurring} onChange={(v: boolean) => setBill({ ...bill, recurring: v })} />
          {err.bill && <p className="err" role="alert"><Icon name="alert" size={16} />{err.bill}</p>}
          <button className="btn btn-secondary" onClick={() => { const a = parseFloat(bill.amount); const dd = parseInt(bill.day, 10); if (!bill.label.trim() || isNaN(a) || a <= 0 || isNaN(dd) || dd < 1 || dd > 31) { setErr({ ...err, bill: 'Add a name, an amount above zero, and a day from 1 to 31.' }); return; } update((d: any) => { d.money.bills.push({ id: uid(), label: bill.label.trim(), amount: a, day: dd, recurring: bill.recurring }); }); setBill({ label: '', amount: '', day: '', recurring: true }); setErr({ ...err, bill: null }); toast('Bill added.'); }}><Icon name="plus" size={18} />Add bill</button>
        </div>
      </section>
    </Screen>
  );
}
