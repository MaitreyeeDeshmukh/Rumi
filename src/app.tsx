declare const ReactDOM: any;
import {
  useState, useEffect, useRef, AppCtx, useApp, Icon, Mascot, MASCOT_COLORS, Chip, Choice, Field, Sim, Empty,
  loadState, saveState, makeDefault, mergeLoaded, speakText, prefersReduced, greeting, todayISO, fmtLong, fmtTime, relDay, daysFromToday, addGrowth,
} from './core';
import { ENCOURAGEMENT } from './data';
import { HealthHome, NewAppt, ApptSaved, CallScript, ApptDetail, PrepScreen, PracticeSetup, Practice, Recap, RecordScreen, Summaries, Transcript, SummaryView, ShareScreen, upcomingAppts, ApptCard } from './health';
import { RescueHome, Changed, RescueFlow, RescueAppt, SayIt, Overwhelmed, Breathe, PauseHere, Unsure, Trusted } from './rescue';
import { CirclesHome, GroupDetail, GroupChat, EventDetail, PrepMeetup, NewEvent, Comfort, allEvents, EventRow, groupById } from './circles';
import { MyDay, TaskDetail, StartWithMe, MoneyMirror, TaskRow } from './day';
import { YouHome, ProfileEdit, CommPrefs, Accessibility, ThemeScreen, Contacts, Privacy, DataControls, GrowthScreen, ThemePicker, HELP_CATS } from './you';

const SCREENS: Record<string, any> = {
  home: Home, day: MyDay, task: TaskDetail, startWithMe: StartWithMe, money: MoneyMirror,
  health: HealthHome, newAppt: NewAppt, apptSaved: ApptSaved, callScript: CallScript, appt: ApptDetail, prep: PrepScreen, practiceSetup: PracticeSetup, practice: Practice, recap: Recap, record: RecordScreen, summaries: Summaries, transcript: Transcript, summary: SummaryView, share: ShareScreen,
  rescue: RescueHome, changed: Changed, rescueFlow: RescueFlow, rescueAppt: RescueAppt, say: SayIt, overwhelmed: Overwhelmed, breathe: Breathe, pauseHere: PauseHere, unsure: Unsure, trusted: Trusted,
  circles: CirclesHome, group: GroupDetail, chat: GroupChat, event: EventDetail, prepMeetup: PrepMeetup, newEvent: NewEvent, comfort: Comfort,
  you: YouHome, profile: ProfileEdit, comm: CommPrefs, access: Accessibility, theme: ThemeScreen, contacts: Contacts, privacy: Privacy, data: DataControls, growth: GrowthScreen,
};
const NO_NAV = new Set(['practice', 'chat', 'rescueFlow', 'rescueAppt', 'say', 'overwhelmed', 'breathe', 'pauseHere', 'unsure', 'trusted', 'changed']);
const TABS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'health', label: 'Health', icon: 'health' },
  { id: 'circles', label: 'Circles', icon: 'circles' },
  { id: 'rescue', label: 'Rescue', icon: 'rescue' },
  { id: 'you', label: 'You', icon: 'you' },
];
const freshStacks = () => ({ home: [{ n: 'home', p: {} }], health: [{ n: 'health', p: {} }], circles: [{ n: 'circles', p: {} }], rescue: [{ n: 'rescue', p: {} }], you: [{ n: 'you', p: {} }] });

function App() {
  const [s, setS] = useState(() => mergeLoaded(loadState()));
  const [route, setRoute] = useState({ tab: 'home', stacks: freshStacks() });
  const [toastMsg, setToastMsg] = useState(null as any);
  const toastTimer = useRef(null as any);
  const viewport = useRef(null as any);

  useEffect(() => { saveState(s); }, [s]);
  useEffect(() => { document.documentElement.style.fontSize = (s.settings.fontScale * 100) + '%'; }, [s.settings.fontScale]);

  const update = (fn: (d: any) => void) => setS((prev: any) => { const n = JSON.parse(JSON.stringify(prev)); fn(n); return n; });
  const toast = (m: string) => { clearTimeout(toastTimer.current); setToastMsg({ m, k: Date.now() }); toastTimer.current = setTimeout(() => setToastMsg(null), 5000); };
  const speak = (t: string) => speakText(t, toast);
  const reduced = s.settings.reducedMotion || prefersReduced();

  const nav = {
    push: (n: string, p: any = {}, tab?: string) => setRoute((r: any) => {
      const t = tab || r.tab; const stacks = { ...r.stacks };
      stacks[t] = tab && tab !== r.tab ? [stacks[t][0], { n, p }] : [...stacks[t], { n, p }];
      return { tab: t, stacks };
    }),
    replace: (n: string, p: any = {}) => setRoute((r: any) => { const stacks = { ...r.stacks }; stacks[r.tab] = [...stacks[r.tab].slice(0, -1), { n, p }]; return { ...r, stacks }; }),
    back: () => setRoute((r: any) => { const st = r.stacks[r.tab]; if (st.length < 2) return r; return { ...r, stacks: { ...r.stacks, [r.tab]: st.slice(0, -1) } }; }),
    reset: (tab: string) => setRoute((r: any) => ({ tab, stacks: { ...r.stacks, [tab]: [r.stacks[tab][0]] } })),
    goTab: (tab: string) => setRoute((r: any) => r.tab === tab ? { tab, stacks: { ...r.stacks, [tab]: [r.stacks[tab][0]] } } : { ...r, tab }),
  };
  const resetAll = () => { const d = makeDefault(); setS(d); setRoute({ tab: 'home', stacks: freshStacks() }); };

  const top = route.stacks[route.tab][route.stacks[route.tab].length - 1];
  const Comp = SCREENS[top.n] || Home;
  const depth = route.stacks[route.tab].length;

  // Focus heading + reset scroll on every screen change (predictable navigation for keyboard and screen readers)
  useEffect(() => {
    const v = viewport.current; if (v) v.scrollTop = 0;
    const t = setTimeout(() => { const h: any = document.querySelector('.app [data-screen-title]'); if (h && document.activeElement && !(document.activeElement as any).closest?.('.sheet')) h.focus({ preventScroll: true }); }, 30);
    return () => clearTimeout(t);
  }, [route.tab, top.n, depth, s.onboarded]);

  const ctx = { s, update, nav, toast, speak, reduced, resetAll, route };
  const cls = ['app', reduced ? 'reduce' : '', s.settings.simplified ? 'simple' : ''].join(' ');
  const flows = [
    { n: '1', t: 'Set up a profile', go: () => update((d: any) => { d.onboarded = false; }) },
    { n: '2', t: 'Book, prepare, practice', go: () => { update((d: any) => { d.onboarded = true; }); nav.push('newAppt', {}, 'health'); } },
    { n: '3', t: 'Summarize and share a visit', go: () => { update((d: any) => { d.onboarded = true; }); nav.push('transcript', {}, 'health'); } },
    { n: '4', t: 'Rescue: bus canceled', go: () => { update((d: any) => { d.onboarded = true; }); nav.push('rescueFlow', { flow: 'bus' }, 'rescue'); } },
    { n: '5', t: 'Join a circle and RSVP', go: () => { update((d: any) => { d.onboarded = true; }); nav.push('group', { id: 'coffee' }, 'circles'); } },
    { n: '6', t: 'Start a task with Rumi', go: () => { update((d: any) => { d.onboarded = true; }); nav.push('day', {}, 'home'); } },
    { n: '7', t: 'Accessibility and themes', go: () => { update((d: any) => { d.onboarded = true; }); nav.push('access', {}, 'you'); } },
  ];

  return (
    <AppCtx.Provider value={ctx}>
      <div className="stage">
        <aside className="panel" aria-label="About this prototype">
          <div className="panel-brand"><Mascot size={56} color={s.profile.color} /><div><span className="wordmark">Rumi</span><span className="tagline">Your world. Your pace. Your way.</span></div></div>
          <p className="panel-lede">An independence and community companion for neurodivergent young adults. Healthcare visits, everyday plans, unexpected moments and friendships, at the pace each person sets.</p>
          <h2 className="panel-h">Walk through a flow</h2>
          <ol className="flow-list">{flows.map(f => <li key={f.n}><button onClick={f.go}><span className="flow-n">{f.n}</span><span>{f.t}</span><Icon name="chev" size={16} /></button></li>)}</ol>
          <h2 className="panel-h">Display</h2>
          <div className="panel-themes" role="group" aria-label="Theme">{[['soft', 'Soft Focus'], ['contrast', 'High Contrast'], ['low', 'Low Light']].map(([id, l]) => <button key={id} aria-pressed={s.settings.theme === id} onClick={() => update((d: any) => { d.settings.theme = id; })}>{l}</button>)}</div>
          <p className="panel-note"><Icon name="info" size={14} />Prototype. AI replies, providers, bookings, members, chats, sharing and notifications are simulated on this device.</p>
        </aside>
        <div className="device">
          <div className={cls} data-app-theme={s.settings.theme}>
            {!s.onboarded ? <Onboarding /> : <>
              <main className="viewport" ref={viewport} key={route.tab + depth + top.n}>
                <Comp p={top.p || {}} />
              </main>
              {!NO_NAV.has(top.n) && <nav className="tabbar" aria-label="Main">
                {TABS.map(t => <button key={t.id} className={'tab tab-' + t.id} aria-current={route.tab === t.id ? 'page' : undefined} onClick={() => nav.goTab(t.id)}><span className="tab-ic"><Icon name={t.icon} size={22} /></span><span>{t.label}</span></button>)}
              </nav>}
            </>}
            <div className="toast-wrap" aria-live="polite" role="status">{toastMsg && <div className="toast" key={toastMsg.k}><Icon name="check" size={18} /><span>{toastMsg.m}</span><button className="icon-btn" aria-label="Dismiss" onClick={() => setToastMsg(null)}><Icon name="x" size={16} /></button></div>}</div>
          </div>
        </div>
      </div>
    </AppCtx.Provider>
  );
}

// ---------- Onboarding ----------
function Onboarding() {
  const { s, update } = useApp();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(s.profile.name);
  const [comp, setComp] = useState(s.profile.companion || 'Rumi');
  const [err, setErr] = useState('');
  const total = 7;
  const go = (n: number) => { setErr(''); setStep(n); setTimeout(() => { const h: any = document.querySelector('.onb [data-screen-title]'); h && h.focus({ preventScroll: true }); }, 30); };
  const next = () => {
    if (step === 1) { update((d: any) => { d.profile.name = name.trim(); }); }
    if (step === 2) { if (!comp.trim()) { setErr('Give your companion a name, or pick one of the suggestions.'); return; } update((d: any) => { d.profile.companion = comp.trim().slice(0, 20); }); }
    go(step + 1);
  };
  const p = s.profile;
  return (
    <div className="onb">
      {step > 0 && <div className="onb-top">
        <button className="icon-btn" onClick={() => go(step - 1)} aria-label="Previous step"><Icon name="back" /></button>
        <div className="onb-progress" aria-label={`Step ${step + 1} of ${total}`}><span style={{ width: `${((step + 1) / total) * 100}%` }} /></div>
        <span className="onb-count">{step + 1} of {total}</span>
      </div>}
      <div className="onb-body">
        {step === 0 && <div className="onb-welcome">
          <div className="welcome-art"><span className="orb o1" /><span className="orb o2" /><Mascot size={150} color={p.color} /></div>
          <span className="wordmark big">Rumi</span>
          <h1 data-screen-title tabIndex={-1}>Your world. Your pace. Your way.</h1>
          <p className="sub">A companion for appointments, everyday plans, surprises and finding your people.</p>
        </div>}
        {step === 1 && <>
          <h1 data-screen-title tabIndex={-1}>Let's make Rumi yours.</h1>
          <p className="sub">What would you like to be called? You can change this any time.</p>
          <Field id="oname" label="Your name or nickname" optional><input id="oname" className="input big-input" value={name} onChange={(e: any) => setName(e.target.value)} onKeyDown={(e: any) => { if (e.key === 'Enter') next(); }} autoComplete="given-name" placeholder="For example, Sam" /></Field>
          <p className="hint">Stays on this device. No account needed for this preview.</p>
        </>}
        {step === 2 && <>
          <h1 data-screen-title tabIndex={-1}>Give your companion a name.</h1>
          <p className="sub">This is who helps you inside the app.</p>
          <div className="onb-mascot"><Mascot size={96} color={p.color} /><strong>{comp || '…'}</strong></div>
          <Field id="ocomp" label="Companion name" error={err}><input id="ocomp" className="input big-input" value={comp} maxLength={20} onChange={(e: any) => { setComp(e.target.value); setErr(''); }} onKeyDown={(e: any) => { if (e.key === 'Enter') next(); }} /></Field>
          <div className="chips">{['Rumi', 'Mochi', 'Nori', 'Kiki', 'Sunny'].map(n => <Chip key={n} on={comp === n} onClick={() => { setComp(n); setErr(''); }}>{n}</Chip>)}</div>
          <fieldset className="field"><legend className="lbl">Color</legend><div className="mascot-pick small">{Object.entries(MASCOT_COLORS).map(([k, v]) => <button key={k} aria-pressed={p.color === k} onClick={() => update((d: any) => { d.profile.color = k; })}><Mascot size={40} color={k} /><span>{v.label}</span></button>)}</div></fieldset>
        </>}
        {step === 3 && <>
          <h1 data-screen-title tabIndex={-1}>How do you like to communicate?</h1>
          <p className="sub">Choose one from each. There are no wrong answers.</p>
          <fieldset className="field"><legend className="lbl">Taking in information</legend>
            <div className="stack">
              <Choice on={p.input === 'read'} onClick={() => update((d: any) => { d.profile.input = 'read'; })} icon="notes" title="Reading" />
              <Choice on={p.input === 'listen'} onClick={() => update((d: any) => { d.profile.input = 'listen'; d.settings.readAloud = true; })} icon="volume" title="Listening" />
              <Choice on={p.input === 'both'} onClick={() => update((d: any) => { d.profile.input = 'both'; })} icon="bubble" title="Both" />
            </div>
          </fieldset>
          <fieldset className="field"><legend className="lbl">Explanations</legend>
            <div className="stack">
              <Choice on={p.detail === 'short'} onClick={() => update((d: any) => { d.profile.detail = 'short'; })} title="Short explanations" desc="Just what to do" />
              <Choice on={p.detail === 'detailed'} onClick={() => update((d: any) => { d.profile.detail = 'detailed'; })} title="More detailed explanations" desc="What to do, plus why and how" />
            </div>
          </fieldset>
        </>}
        {step === 4 && <>
          <h1 data-screen-title tabIndex={-1}>What would you like help with?</h1>
          <p className="sub">Pick as many as you like. Everything stays available either way.</p>
          <div className="help-grid">{HELP_CATS.map((c, i) => <button key={c} className="help-opt" aria-pressed={p.help.includes(c)} onClick={() => update((d: any) => { d.profile.help = d.profile.help.includes(c) ? d.profile.help.filter((x: string) => x !== c) : [...d.profile.help, c]; })}><Icon name={['health', 'circles', 'cal', 'rescue', 'bubble', 'wallet'][i]} size={24} /><span>{c}</span><span className="choice-mark" aria-hidden="true">{p.help.includes(c) && <Icon name="check" size={16} />}</span></button>)}</div>
        </>}
        {step === 5 && <>
          <h1 data-screen-title tabIndex={-1}>Choose a display theme.</h1>
          <p className="sub">The app changes as you pick. You can switch any time in You.</p>
          <ThemePicker />
        </>}
        {step === 6 && <div className="onb-done">
          <Mascot size={110} color={p.color} mood="happy" />
          <h1 data-screen-title tabIndex={-1}>Welcome{p.name ? `, ${p.name}` : ''}.</h1>
          <p className="sub">{p.companion} is ready when you are. Here's what you set up.</p>
          <ul className="setup-list">
            <li><Icon name="bubble" size={18} />{p.input === 'listen' ? 'Listening' : p.input === 'read' ? 'Reading' : 'Reading and listening'}, {p.detail === 'detailed' ? 'more detail' : 'short explanations'}</li>
            <li><Icon name="list" size={18} />{p.help.length ? p.help.join(', ') : 'Help with everything'}</li>
            <li><Icon name="contrast" size={18} />{s.settings.theme === 'soft' ? 'Soft Focus' : s.settings.theme === 'low' ? 'Low Light' : 'High Contrast'} theme</li>
          </ul>
          <p className="hint">The dashboard includes sample content so you can explore. You can remove it in You.</p>
        </div>}
      </div>
      <div className="onb-foot">
        {step === 0 && <button className="btn btn-primary big" onClick={() => go(1)}>Get started</button>}
        {step > 0 && step < 6 && <button className="btn btn-primary big" onClick={next}>{step === 1 && !name.trim() ? 'Skip for now' : 'Continue'}</button>}
        {step === 6 && <button className="btn btn-primary big" onClick={() => update((d: any) => { d.onboarded = true; })}>Go to my dashboard</button>}
      </div>
    </div>
  );
}

// ---------- Home ----------
function Home() {
  const { s, nav, update, toast } = useApp();
  const simple = s.settings.simplified;
  const today = todayISO();
  const up = upcomingAppts(s);
  const next = up[0];
  const meet = allEvents(s).find((e: any) => daysFromToday(e.date) >= 0 && (s.rsvps[e.id] === 'going' || s.rsvps[e.id] === 'maybe')) || allEvents(s).find((e: any) => daysFromToday(e.date) >= 0 && s.joined.includes(e.groupId));
  const tasks = s.tasks.filter((t: any) => !t.done && t.date <= today);
  const enc = ENCOURAGEMENT[new Date().getDate() % ENCOURAGEMENT.length];
  const reminderId = next && !s.prep[next.id] && daysFromToday(next.date) <= 7 ? 'prep-' + next.id : '';
  const showReminder = reminderId && s.settings.notif.appointments && !s.dismissed.includes(reminderId);
  const msg = tasks.length ? `You have ${tasks.length} ${tasks.length === 1 ? 'thing' : 'things'} on your list today. Pick any one to start.` : 'Your list is clear today.';
  return (
    <div className="screen home">
      <div className="screen-body">
        <div className="home-head">
          <div className="home-greet">
            <p className="eyebrow">{fmtLong(today)}</p>
            <h1 data-screen-title tabIndex={-1}>{greeting()}{s.profile.name ? `, ${s.profile.name}` : ''}.</h1>
            <p className="sub">Your world, your pace.</p>
          </div>
          <button className="home-mascot" onClick={() => nav.goTab('you')} aria-label={`${s.profile.companion}, your companion. Open settings.`}><Mascot size={72} color={s.profile.color} /></button>
        </div>
        <div className="companion-note"><strong>{s.profile.companion}</strong><span>{msg}</span></div>
        <div className="tiles">
          <button className="tile bg-lav" onClick={() => nav.goTab('health')}><Icon name="health" size={28} /><span><strong>My Health</strong>{!simple && <span>{next ? `Next: ${relDay(next.date)}` : 'Plan a visit'}</span>}</span></button>
          <button className="tile bg-sage" onClick={() => nav.goTab('circles')}><Icon name="circles" size={28} /><span><strong>My Circles</strong>{!simple && <span>{s.joined.length ? `${s.joined.length} joined` : 'Find your people'}</span>}</span></button>
          <button className="tile bg-apricot" onClick={() => nav.goTab('rescue')}><Icon name="rescue" size={28} /><span><strong>I Need Help</strong>{!simple && <span>One step at a time</span>}</span></button>
          <button className="tile bg-blue" onClick={() => nav.push('day')}><Icon name="sun" size={28} /><span><strong>My Day</strong>{!simple && <span>{tasks.length} to do</span>}</span></button>
        </div>
        {showReminder && <div className="reminder">
          <Icon name="notes" size={20} />
          <div><strong>Your {next.kind.toLowerCase()} visit is {relDay(next.date).toLowerCase()}.</strong><span>Writing a few notes first can make it easier to talk.</span>
            <div className="btn-row"><button className="btn btn-primary btn-sm" onClick={() => nav.push('prep', { apptId: next.id }, 'health')}>Prepare now</button><button className="btn btn-ghost btn-sm" onClick={() => update((d: any) => { d.dismissed.push(reminderId); })}>Not now</button></div></div>
        </div>}
        <section className="section">
          <h2>Coming up</h2>
          {next ? <ApptCard a={next} onClick={() => nav.push('appt', { id: next.id }, 'health')} /> : <Empty icon="cal" title="No appointments planned" action={<button className="btn btn-secondary btn-sm" onClick={() => nav.push('newAppt', {}, 'health')}>Add one</button>} />}
          {!simple && (meet ? <EventRow e={meet} /> : <button className="soft-link" onClick={() => nav.goTab('circles')}><Icon name="circles" size={18} />Join a circle to see meetups here<Icon name="chev" size={16} /></button>)}
        </section>
        <section className="section">
          <div className="section-head"><h2>Today's tasks</h2><button className="btn btn-ghost btn-sm" onClick={() => nav.push('day')}>See all</button></div>
          {tasks.length === 0 ? <p className="hint">Nothing on your list. <button className="link" onClick={() => nav.push('day')}>Add a task</button></p> :
            <div className="task-list">{tasks.slice(0, simple ? 2 : 3).map((t: any) => <TaskRow key={t.id} t={t} onToggle={() => { update((d: any) => { const x = d.tasks.find((y: any) => y.id === t.id); x.done = true; addGrowth(d, 'task', `Completed "${x.title}"`); }); toast('Done. Nice.'); }} />)}</div>}
        </section>
        {!simple && s.settings.notif.encouragement && !s.dismissed.includes('enc-' + today) && <div className="encourage">
          <Icon name="sprout" size={20} /><p>{enc}</p><button className="icon-btn" aria-label="Hide for today" onClick={() => update((d: any) => { d.dismissed.push('enc-' + today); })}><Icon name="x" size={16} /></button>
        </div>}
        {(next && next.sample) && <p className="fineprint"><Icon name="info" size={14} />Items marked Sample are demo content. Remove them in You, Your data.</p>}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
