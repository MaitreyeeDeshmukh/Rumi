import { useState, useEffect, useRef, useApp, Screen, Icon, Field, Chip, Choice, Row, Empty, Sim, Sheet, Toggle, Avatar, fmtDate, fmtLong, fmtTime, relDay, todayISO, uid, addGrowth, daysFromToday } from './core';
import { GROUPS, FILTERS, SEED_EVENTS, SEED_MESSAGES, DEMO_REPLIES, COMFORT_PREFS } from './data';

export const allEvents = (s: any) => [...SEED_EVENTS, ...s.events].sort((a: any, b: any) => (a.date + a.time).localeCompare(b.date + b.time));
export const groupById = (id: string) => GROUPS.find(g => g.id === id);
const memberCount = (s: any, g: any) => g.members + (s.joined.includes(g.id) ? 1 : 0);

export function DemoBanner() {
  return <div className="notice"><Icon name="info" size={18} /><span>Demo community. Members, messages and events are simulated on this device. Human moderation, age verification and event safety checks are planned for production and are not active here.</span></div>;
}

function GroupMark({ g, size = 48 }: any) {
  const icon: Record<string, string> = { coffee: 'smile', creative: 'edit', gaming: 'play', adhd: 'sparkle', adulting: 'list', study: 'notes', books: 'eye' };
  return <span className={'gmark bg-' + g.tone} style={{ width: size, height: size }} aria-hidden="true"><Icon name={icon[g.id] || 'circles'} size={size * 0.46} /></span>;
}

export function CirclesHome() {
  const { s, nav, update, toast } = useApp();
  const [tab, setTab] = useState('discover');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ interest: [] as string[], size: [] as string[], mode: [] as string[], comm: [] as string[] });
  const toggle = (k: string, v: string) => setF((x: any) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y: string) => y !== v) : [...x[k], v] }));
  const nFilters = f.interest.length + f.size.length + f.mode.length + f.comm.length;
  let list = GROUPS.filter(g => (!f.interest.length || f.interest.includes(g.topic)) && (!f.size.length || f.size.includes(g.size)) && (!f.mode.length || f.mode.includes(g.mode)) && (!f.comm.length || f.comm.some(c => g.comm.includes(c))));
  if (tab === 'mine') list = GROUPS.filter(g => s.joined.includes(g.id));
  const join = (g: any) => { const on = s.joined.includes(g.id); update((d: any) => { d.joined = on ? d.joined.filter((x: string) => x !== g.id) : [...d.joined, g.id]; }); toast(on ? `You left ${g.name}.` : `You joined ${g.name}.`); };
  const myEvents = allEvents(s).filter((e: any) => s.joined.includes(e.groupId) && daysFromToday(e.date) >= 0).slice(0, 2);
  return (
    <Screen title="Find your people." sub="Connection without the pressure." back={false} label="Circles" actions={<button className="icon-btn" aria-label="Social comfort settings" onClick={() => nav.push('comfort')}><Icon name="sliders" /></button>}>
      <div className="seg" role="group" aria-label="View">
        <button aria-pressed={tab === 'discover'} onClick={() => setTab('discover')}>Discover</button>
        <button aria-pressed={tab === 'mine'} onClick={() => setTab('mine')}>My circles ({s.joined.length})</button>
      </div>
      {tab === 'discover' && <div className="filter-bar">
        <button className="chip" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="filter" size={16} />Filters{nFilters ? ` (${nFilters})` : ''}</button>
        {nFilters > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setF({ interest: [], size: [], mode: [], comm: [] })}>Clear</button>}
      </div>}
      {tab === 'discover' && open && <div className="filters card">
        {[['interest', 'Interests'], ['size', 'Group size'], ['mode', 'Online or local'], ['comm', 'Communication style']].map(([k, l]) => (
          <fieldset key={k} className="field"><legend className="lbl-sm">{l}</legend><div className="chips">{(FILTERS as any)[k].map((v: string) => <Chip key={v} on={(f as any)[k].includes(v)} onClick={() => toggle(k, v)}>{v}</Chip>)}</div></fieldset>
        ))}
        <p className="hint small">Circles are built around interests and comfort, never diagnoses.</p>
      </div>}
      {tab === 'mine' && myEvents.length > 0 && <section className="section tight"><h2>Coming up in your circles</h2>{myEvents.map((e: any) => <EventRow key={e.id} e={e} />)}</section>}
      <div className="stack" style={{ marginTop: 14 }}>
        {list.length === 0 ? (tab === 'mine' ? <Empty icon="circles" title="You haven't joined any circles yet" body="Joining is free and you can leave any time." action={<button className="btn btn-primary" onClick={() => setTab('discover')}>Discover circles</button>} />
          : <Empty icon="filter" title="No circles match these filters" action={<button className="btn btn-secondary" onClick={() => setF({ interest: [], size: [], mode: [], comm: [] })}>Clear filters</button>} />)
          : list.map(g => {
            const on = s.joined.includes(g.id);
            return (
              <article key={g.id} className="gcard">
                <button className="gcard-main" onClick={() => nav.push('group', { id: g.id })} aria-label={`Open ${g.name}`}>
                  <GroupMark g={g} />
                  <span className="gcard-text">
                    <strong>{g.name}</strong>
                    <span>{g.desc}</span>
                    <span className="meta"><Icon name="circles" size={14} />{memberCount(s, g)} members<span className="dot" aria-hidden="true">·</span>{g.mode === 'Local' ? <><Icon name="pin" size={14} />Local</> : <><Icon name="video" size={14} />Online</>}<span className="dot" aria-hidden="true">·</span>{g.size}</span>
                  </span>
                </button>
                <div className="gcard-foot">
                  <span className="chip-static">{g.topic}</span>
                  <button className={'btn btn-sm ' + (on ? 'btn-secondary' : 'btn-primary')} aria-pressed={on} onClick={() => join(g)}>{on ? <><Icon name="check" size={16} />Joined</> : 'Join'}</button>
                </div>
              </article>
            );
          })}
      </div>
      <div className="list" style={{ marginTop: 20 }}>
        <Row icon="plus" tone="sage" title="Suggest a meetup" desc="Plan something with a circle" onClick={() => nav.push('newEvent', {})} />
        <Row icon="sliders" tone="lav" title="Social comfort settings" desc="Share how you like to connect" onClick={() => nav.push('comfort')} />
      </div>
      <p className="fineprint"><Icon name="shield" size={14} />Circles is for people 18 and older. A separate experience for younger users is planned.</p>
    </Screen>
  );
}

function EventRow({ e }: any) {
  const { s, nav } = useApp();
  const g = groupById(e.groupId);
  const r = s.rsvps[e.id];
  return (
    <button className="event-row" onClick={() => nav.push('event', { id: e.id }, 'circles')}>
      <span className="date-block small"><span>{new Date(e.date + 'T00:00').toLocaleDateString(undefined, { month: 'short' })}</span><strong>{new Date(e.date + 'T00:00').getDate()}</strong></span>
      <span className="row-text"><strong>{e.title}</strong><span>{relDay(e.date)}, {fmtTime(e.time)} · {g ? g.name : ''}</span></span>
      {r && <span className={'pill ' + (r === 'going' ? 'pill-ok' : 'pill-neutral')}>{r === 'going' ? 'Going' : r === 'maybe' ? 'Maybe' : 'Not going'}</span>}
    </button>
  );
}
export { EventRow };

export function GroupDetail({ p }: any) {
  const { s, nav, update, toast } = useApp();
  const g = groupById(p.id);
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState(false);
  if (!g) return <Screen title="Circle not found"><Empty icon="circles" title="This circle isn't available." /></Screen>;
  const on = s.joined.includes(g.id);
  const evs = allEvents(s).filter((e: any) => e.groupId === g.id && daysFromToday(e.date) >= 0);
  return (
    <Screen title={g.name} label="Circle" actions={<button className="icon-btn" aria-label="Report this circle" onClick={() => setReport(true)}><Icon name="flag" /></button>}>
      <div className="group-hero">
        <GroupMark g={g} size={64} />
        <div><p>{g.desc}</p><span className="meta"><Icon name="circles" size={14} />{memberCount(s, g)} members<span className="dot">·</span>{g.mode}<span className="dot">·</span>{g.size} group</span></div>
      </div>
      <div className="chips static">{g.comm.map(c => <span className="chip-static" key={c}>{c}</span>)}</div>
      <div className="btn-row" style={{ marginTop: 16 }}>
        {on ? <button className="btn btn-primary grow" onClick={() => nav.push('chat', { id: g.id })}><Icon name="bubble" size={18} />Open group chat</button>
          : <button className="btn btn-primary grow" onClick={() => { update((d: any) => { d.joined.push(g.id); }); toast(`You joined ${g.name}.`); }}>Join circle</button>}
      </div>
      <section className="section"><h2>Upcoming events</h2>
        {evs.length === 0 ? <Empty icon="cal" title="No events planned" action={on && <button className="btn btn-secondary" onClick={() => nav.push('newEvent', { groupId: g.id })}>Suggest a meetup</button>} /> : evs.map((e: any) => <EventRow key={e.id} e={e} />)}
      </section>
      <section className="section"><h2>Community rules</h2><ul className="rules">{g.rules.map(r => <li key={r}><Icon name="check" size={16} />{r}</li>)}</ul></section>
      <section className="section"><div className="section-head"><h2>Members</h2><Sim>Demo members</Sim></div>
        <div className="member-strip">{g.people.map(m => <span key={m} className="member"><Avatar name={m} size={40} /><span>{m}</span>{s.blocked.includes(m) && <span className="pill pill-neutral">Blocked</span>}</span>)}{on && <span className="member"><Avatar name={s.profile.name || 'You'} size={40} tone="lav" /><span>You</span></span>}</div>
      </section>
      <section className="section"><h2>Safety</h2>
        <div className="list">
          <Row icon="flag" title="Report this circle" onClick={() => setReport(true)} />
          <Row icon="lock" title="Privacy controls" desc="Choose what others can see" onClick={() => nav.push('comfort')} />
          {on && (!confirm ? <Row icon="leave" title="Leave circle" onClick={() => setConfirm(true)} right={null} />
            : <div className="confirm-box"><p>Leave {g.name}? You can join again later.</p><div className="btn-row"><button className="btn btn-secondary" onClick={() => setConfirm(false)}>Stay</button><button className="btn btn-danger" onClick={() => { update((d: any) => { d.joined = d.joined.filter((x: string) => x !== g.id); }); setConfirm(false); toast(`You left ${g.name}.`); }}>Leave</button></div></div>)}
        </div>
      </section>
      {report && <ReportSheet target={g.name} kind="circle" onClose={() => setReport(false)} />}
    </Screen>
  );
}

export function ReportSheet({ target, kind, onClose }: any) {
  const { update, toast } = useApp();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  return (
    <Sheet title={done ? 'Report saved' : `Report ${kind}`} onClose={onClose}>
      {done ? <div className="stack"><p>Your report about {target} is saved on this device.</p><div className="notice warn"><Icon name="info" size={18} /><span>In the real app, a trained human moderator would review it. Moderation isn't active in this preview.</span></div><button className="btn btn-primary" onClick={onClose}>Close</button></div> : <>
        <fieldset className="field"><legend className="lbl">What's wrong?</legend>
          <div className="stack">{['Made me uncomfortable', 'Spam or selling', 'Unsafe meetup', 'Harassment or bullying', 'Something else'].map(r => <Choice key={r} on={reason === r} onClick={() => { setReason(r); setErr(''); }} title={r} />)}</div>
          {err && <p className="err" role="alert"><Icon name="alert" size={16} />{err}</p>}
        </fieldset>
        <Field id="rdetails" label="Details" optional><textarea id="rdetails" className="input" rows={3} value={details} onChange={(e: any) => setDetails(e.target.value)} /></Field>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => { if (!reason) { setErr('Choose a reason.'); return; } update((d: any) => d.reports.push({ id: uid(), target, kind, reason, details, date: todayISO() })); setDone(true); toast('Report saved.'); }}>Submit report</button>
      </>}
    </Sheet>
  );
}

const EMOJI = ['👍', '❤️', '😄', '🙌'];
export function GroupChat({ p }: any) {
  const { s, nav, update, toast } = useApp();
  const g = groupById(p.id)!;
  const msgs = (s.messages[g.id] || SEED_MESSAGES[g.id] || []) as any[];
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null as any);
  const [menu, setMenu] = useState(null as any);
  const [report, setReport] = useState(null as any);
  const [blockConfirm, setBlockConfirm] = useState(null as any);
  const [starters, setStarters] = useState(true);
  const endRef = useRef(null as any);
  const replied = useRef(false);
  const me = 'You';
  useEffect(() => { endRef.current && endRef.current.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  const write = (fn: (list: any[]) => any[]) => update((d: any) => { d.messages[g.id] = fn(d.messages[g.id] || JSON.parse(JSON.stringify(SEED_MESSAGES[g.id] || []))); });
  const send = () => {
    if (!text.trim()) return;
    const m = { id: uid(), user: me, text: text.trim(), ts: Date.now(), reactions: {}, replyTo: replyTo ? replyTo.id : undefined };
    write(l => [...l, m]); setText(''); setReplyTo(null);
    if (!replied.current && g.people[0] && !s.blocked.includes(g.people[0])) {
      replied.current = true;
      setTimeout(() => update((d: any) => { d.messages[g.id] = [...(d.messages[g.id] || []), { id: uid(), user: g.people[0], text: DEMO_REPLIES[g.id], ts: Date.now(), reactions: {}, sim: true }]; }), 2400);
    }
  };
  const react = (m: any, e: string) => write(l => l.map(x => { if (x.id !== m.id) return x; const r = { ...x.reactions }; const users = r[e] || []; r[e] = users.includes(me) ? users.filter((u: string) => u !== me) : [...users, me]; if (!r[e].length) delete r[e]; return { ...x, reactions: r }; }));
  const byId = (id: string) => msgs.find(x => x.id === id);
  const time = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (!s.joined.includes(g.id)) return <Screen title={g.name}><Empty icon="lock" title="Join this circle to chat" action={<button className="btn btn-primary" onClick={() => { update((d: any) => { d.joined.push(g.id); }); toast(`You joined ${g.name}.`); }}>Join circle</button>} /></Screen>;
  return (
    <div className="screen chat-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={nav.back} aria-label="Go back"><Icon name="back" /></button>
        <button className="chat-title" onClick={() => nav.push('group', { id: g.id })}><strong>{g.name}</strong><span>{memberCount(s, g)} members · simulated chat</span></button>
        <div className="topbar-actions"><button className="icon-btn" aria-label="Circle info and safety" onClick={() => nav.push('group', { id: g.id })}><Icon name="info" /></button></div>
      </header>
      <h1 className="sr-only" data-screen-title tabIndex={-1}>{g.name} chat</h1>
      <div className="chat-body">
        <div className="chat-banner"><Icon name="info" size={16} /><span>This is a local demo, not a live chat. Other people's messages are made up. Take as long as you need to reply.</span></div>
        {msgs.map((m: any) => {
          const mine = m.user === me;
          if (s.blocked.includes(m.user)) return <div key={m.id} className="msg-hidden"><Icon name="block" size={14} />Message from a blocked member is hidden.</div>;
          const rt = m.replyTo ? byId(m.replyTo) : null;
          return (
            <div key={m.id} className={'msg' + (mine ? ' mine' : '')}>
              {!mine && <Avatar name={m.user} size={34} />}
              <div className="msg-col">
                <div className="msg-meta"><strong>{mine ? 'You' : m.user}</strong><span>{time(m.ts)}</span>{m.sim && <Sim>Demo reply</Sim>}</div>
                <div className="bubble">
                  {rt && <span className="reply-quote"><Icon name="reply" size={12} />{rt.user === me ? 'You' : rt.user}: {rt.text.slice(0, 60)}{rt.text.length > 60 ? '…' : ''}</span>}
                  {m.text}
                </div>
                <div className="msg-actions">
                  {Object.entries(m.reactions || {}).map(([e, users]: any) => <button key={e} className="react" aria-pressed={users.includes(me)} onClick={() => react(m, e)} aria-label={`${e} ${users.length}, ${users.includes(me) ? 'remove your reaction' : 'add yours'}`}>{e} {users.length}</button>)}
                  <button className="msg-more" onClick={() => setMenu(m)} aria-label={`More options for message from ${mine ? 'you' : m.user}`}><Icon name="more" size={18} /></button>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div className="composer">
        {starters && !text && <div className="starters"><span className="lbl-sm">Conversation starters</span><div className="chips scroll-x">{g.starters.map(t => <button key={t} className="chip" onClick={() => setText(t)}>{t}</button>)}<button className="chip" onClick={() => setStarters(false)} aria-label="Hide conversation starters"><Icon name="x" size={14} /></button></div></div>}
        {replyTo && <div className="replying"><Icon name="reply" size={14} />Replying to {replyTo.user === me ? 'yourself' : replyTo.user}<button className="icon-btn" aria-label="Cancel reply" onClick={() => setReplyTo(null)}><Icon name="x" size={16} /></button></div>}
        <form className="le-row" onSubmit={(e: any) => { e.preventDefault(); send(); }}>
          <label className="sr-only" htmlFor="chatin">Message</label>
          <input id="chatin" className="input" value={text} onChange={(e: any) => setText(e.target.value)} placeholder="Write a message" autoComplete="off" />
          <button className="icon-btn filled" type="submit" aria-label="Send message" disabled={!text.trim()}><Icon name="send" size={18} /></button>
        </form>
      </div>
      {menu && <Sheet title="Message options" onClose={() => setMenu(null)}>
        <p className="lbl-sm">React</p>
        <div className="chips">{EMOJI.map(e => <button key={e} className="chip emoji" onClick={() => { react(menu, e); setMenu(null); }} aria-label={`React with ${e}`}>{e}</button>)}</div>
        <div className="list" style={{ marginTop: 12 }}>
          <Row icon="reply" title="Reply" onClick={() => { setReplyTo(menu); setMenu(null); setTimeout(() => { const el = document.getElementById('chatin'); el && el.focus(); }, 50); }} right={null} />
          {menu.user !== me && <Row icon="flag" title="Report message" onClick={() => { setReport(menu); setMenu(null); }} right={null} />}
          {menu.user !== me && <Row icon="block" title={`Block ${menu.user}`} onClick={() => { setBlockConfirm(menu.user); setMenu(null); }} right={null} />}
          {menu.user === me && <Row icon="trash" title="Delete my message" onClick={() => { write(l => l.filter(x => x.id !== menu.id)); setMenu(null); toast('Message deleted.'); }} right={null} />}
        </div>
      </Sheet>}
      {blockConfirm && <Sheet title={`Block ${blockConfirm}?`} onClose={() => setBlockConfirm(null)}>
        <p>You won't see their messages in any circle. They won't be told. You can unblock them in You, Privacy.</p>
        <div className="btn-row"><button className="btn btn-secondary" onClick={() => setBlockConfirm(null)}>Cancel</button><button className="btn btn-danger grow" onClick={() => { update((d: any) => { if (!d.blocked.includes(blockConfirm)) d.blocked.push(blockConfirm); }); toast(`${blockConfirm} is blocked on this device.`); setBlockConfirm(null); }}>Block</button></div>
      </Sheet>}
      {report && <ReportSheet target={`a message from ${report.user}`} kind="message" onClose={() => setReport(null)} />}
    </div>
  );
}

export function EventDetail({ p }: any) {
  const { s, nav, update, toast } = useApp();
  const e = allEvents(s).find((x: any) => x.id === p.id);
  const [report, setReport] = useState(false);
  if (!e) return <Screen title="Event not found"><Empty icon="cal" title="This event isn't available." /></Screen>;
  const g = groupById(e.groupId)!;
  const r = s.rsvps[e.id];
  const going = [...e.attendees, ...(r === 'going' ? ['You'] : [])];
  const set = (v: string) => { update((d: any) => { d.rsvps[e.id] = v; }); toast(v === 'going' ? "You're going. The host will see your RSVP (demo)." : v === 'maybe' ? 'Marked as maybe.' : 'Marked as not going. No explanation needed.'); };
  const attended = s.attended.includes(e.id);
  return (
    <Screen title={e.title} sub={g.name} label="Meetup" actions={<button className="icon-btn" aria-label="Report this event" onClick={() => setReport(true)}><Icon name="flag" /></button>}>
      {e.custom && <Sim>Suggested by you</Sim>}
      <div className="event-facts">
        <div><Icon name="cal" size={20} /><span><strong>When</strong>{fmtLong(e.date)}, {fmtTime(e.time)}{e.end ? ` to ${fmtTime(e.end)}` : ''}</span></div>
        <div><Icon name="pin" size={20} /><span><strong>Where</strong>{e.where} <span className="muted">({e.locType})</span></span></div>
        <div><Icon name="smile" size={20} /><span><strong>Activity</strong>{e.activity}</span></div>
        <div><Icon name="circles" size={20} /><span><strong>Expected group size</strong>{e.size}</span></div>
      </div>
      <section className="section"><h2>RSVP</h2>
        <div className="seg" role="group" aria-label="RSVP">{[['going', 'Going'], ['maybe', 'Maybe'], ['no', 'Not going']].map(([v, l]) => <button key={v} aria-pressed={r === v} onClick={() => set(v)}>{r === v && <Icon name="check" size={16} />}{l}</button>)}</div>
        <p className="hint">You can change this any time.</p>
      </section>
      <section className="section"><h2>What to bring</h2><ul className="rules">{e.bring.map((b: string) => <li key={b}><Icon name="check" size={16} />{b}</li>)}</ul></section>
      <section className="section"><h2>What to expect</h2><ol className="expect">{e.expect.map((b: string) => <li key={b}>{b}</li>)}</ol></section>
      <section className="section"><h2>Leaving early</h2><div className="card bg-sage"><p style={{ margin: 0 }}>{e.leave}</p></div></section>
      {e.access && e.access.length > 0 && <section className="section"><h2>Accessibility</h2><div className="chips static">{e.access.map((a: string) => <span className="chip-static" key={a}>{a}</span>)}</div></section>}
      <section className="section"><div className="section-head"><h2>Who's going ({going.length})</h2><Sim>Demo RSVPs</Sim></div>
        <div className="member-strip">{going.map(m => <span key={m} className="member"><Avatar name={m === 'You' ? (s.profile.name || 'You') : m} size={40} tone={m === 'You' ? 'lav' : undefined} /><span>{m}</span></span>)}</div>
      </section>
      <div className="stack" style={{ marginTop: 20 }}>
        <button className="btn btn-primary" onClick={() => nav.push('prepMeetup', { id: e.id })}><Icon name="notes" size={18} />Prepare for this meetup</button>
        {r === 'going' && !attended && <button className="btn btn-secondary" onClick={() => { update((d: any) => { d.attended.push(e.id); addGrowth(d, 'meetup', `Attended ${e.title}`); }); toast('Added to My Growth.'); }}>I went to this</button>}
        {attended && <p className="ok-line"><Icon name="check" size={16} />You marked this as attended.</p>}
      </div>
      <div className="notice" style={{ marginTop: 16 }}><Icon name="shield" size={18} /><span>Meet in public places. Venue and host safety checks are planned for production and are not active in this preview.</span></div>
      {report && <ReportSheet target={e.title} kind="event" onClose={() => setReport(false)} />}
    </Screen>
  );
}

export function PrepMeetup({ p }: any) {
  const { s, update } = useApp();
  const e = allEvents(s).find((x: any) => x.id === p.id);
  if (!e) return <Screen title="Prepare"><Empty icon="cal" title="Event not found" /></Screen>;
  const g = groupById(e.groupId)!;
  const items = ['Know how I am getting there', 'Check the start and end time', ...e.bring.map((b: string) => 'Bring: ' + b), 'Charge my phone', 'Pick one conversation starter', 'Decide how I will leave if I need to'];
  const done: string[] = s.checklists[e.id] || [];
  const tick = (it: string) => update((d: any) => { const l = d.checklists[e.id] || []; d.checklists[e.id] = l.includes(it) ? l.filter((x: string) => x !== it) : [...l, it]; });
  return (
    <Screen title="Prepare for this meetup" sub={`${e.title} · ${relDay(e.date)}`} label="Meetup">
      <section className="section tight"><div className="section-head"><h2>Checklist</h2><span className="muted small">{done.length} of {items.length}</span></div>
        <div className="checklist">{items.map(it => <button key={it} className="check-item" role="checkbox" aria-checked={done.includes(it)} onClick={() => tick(it)}><span className="box">{done.includes(it) && <Icon name="check" size={16} />}</span><span>{it}</span></button>)}</div>
      </section>
      <section className="section"><h2>Conversation starters</h2><p className="hint">Optional. Talking is never required.</p>
        <ul className="tips">{[...g.starters, 'How did you find this circle?', 'Have you been to one of these before?'].map(t => <li key={t}>"{t}"</li>)}</ul>
      </section>
      <section className="section"><h2>If you want to leave early</h2><div className="card bg-sage"><p style={{ margin: 0 }}>{e.leave}</p></div></section>
    </Screen>
  );
}

export function NewEvent({ p }: any) {
  const { s, nav, update, toast } = useApp();
  const joined = GROUPS.filter(g => s.joined.includes(g.id));
  const [f, setF] = useState({ groupId: p.groupId || (joined[0] && joined[0].id) || '', title: '', date: '', time: '', locType: 'Café', where: '', desc: '', size: '2 to 4 people', access: [] as string[], accessNote: '' });
  const [err, setErr] = useState({} as any);
  const [preview, setPreview] = useState(false);
  const set = (k: string, v: any) => { setF((x: any) => ({ ...x, [k]: v })); setErr((e: any) => ({ ...e, [k]: null })); };
  if (joined.length === 0) return <Screen title="Suggest a meetup" label="Circles"><Empty icon="circles" title="Join a circle first" body="Meetups are planned inside a circle." action={<button className="btn btn-primary" onClick={() => nav.reset('circles')}>Discover circles</button>} /></Screen>;
  const validate = () => { const e: any = {}; if (!f.title.trim()) e.title = 'Give your meetup a name.'; if (!f.date) e.date = 'Pick a date.'; else if (daysFromToday(f.date) < 0) e.date = 'Pick today or a later date.'; if (!f.time) e.time = 'Pick a start time.'; if (!f.where.trim()) e.where = f.locType === 'Online' ? 'Say where people will meet online.' : 'Add a place.'; setErr(e); return !Object.keys(e).length; };
  const post = () => {
    const id = 'u-' + uid();
    update((d: any) => { d.events.push({ id, custom: true, groupId: f.groupId, title: f.title.trim(), date: f.date, time: f.time, end: '', locType: f.locType, where: f.where.trim(), activity: f.desc.trim() || 'Hang out together.', size: f.size, bring: ['Nothing special'], expect: ['The host says hello when people arrive.', 'Plans are shared in the group chat.'], leave: 'Leaving early is always fine. Just say bye in the chat.', access: [...f.access, ...(f.accessNote.trim() ? [f.accessNote.trim()] : [])], attendees: [] }); d.rsvps[id] = 'going'; });
    toast('Meetup posted to your circle (demo).'); nav.replace('event', { id });
  };
  const ACC = ['Step-free access', 'Quiet space', 'Restroom nearby', 'Camera optional', 'Text chat available', 'Near public transit'];
  return (
    <Screen title={preview ? 'Check your meetup' : 'Suggest a meetup'} label="Circles">
      {!preview ? <div className="stack-lg">
        <fieldset className="field"><legend className="lbl">Which circle?</legend><div className="chips">{joined.map(g => <Chip key={g.id} on={f.groupId === g.id} onClick={() => set('groupId', g.id)}>{g.name}</Chip>)}</div></fieldset>
        <Field id="etitle" label="Name" error={err.title}><input id="etitle" className="input" value={f.title} onChange={(e: any) => set('title', e.target.value)} placeholder="Saturday Coffee Circle" /></Field>
        <div className="grid2">
          <Field id="edate" label="Date" error={err.date}><input id="edate" type="date" min={todayISO()} className="input" value={f.date} onChange={(e: any) => set('date', e.target.value)} /></Field>
          <Field id="etime" label="Start time" error={err.time}><input id="etime" type="time" className="input" value={f.time} onChange={(e: any) => set('time', e.target.value)} /></Field>
        </div>
        <fieldset className="field"><legend className="lbl">Type of place</legend><div className="chips">{['Café', 'Library', 'Park', 'Online', 'Other'].map(t => <Chip key={t} on={f.locType === t} onClick={() => set('locType', t)}>{t}</Chip>)}</div></fieldset>
        <Field id="ewhere" label={f.locType === 'Online' ? 'Where online?' : 'Place'} error={err.where}><input id="ewhere" className="input" value={f.where} onChange={(e: any) => set('where', e.target.value)} placeholder={f.locType === 'Online' ? 'Group video room' : 'Name and street'} /></Field>
        <Field id="edesc" label="What will you do?" optional><textarea id="edesc" className="input" rows={3} value={f.desc} onChange={(e: any) => set('desc', e.target.value)} placeholder="Coffee and quiet chat. Reading is welcome." /></Field>
        <fieldset className="field"><legend className="lbl">Group size</legend><div className="seg">{['2 to 4 people', '5 to 8 people', '9 or more'].map(v => <button key={v} aria-pressed={f.size === v} onClick={() => set('size', v)}>{v}</button>)}</div></fieldset>
        <fieldset className="field"><legend className="lbl">Accessibility</legend><div className="chips">{ACC.map(a => <Chip key={a} on={f.access.includes(a)} onClick={() => set('access', f.access.includes(a) ? f.access.filter((x: string) => x !== a) : [...f.access, a])}>{a}</Chip>)}</div>
          <input className="input" aria-label="Other accessibility notes" value={f.accessNote} onChange={(e: any) => set('accessNote', e.target.value)} placeholder="Other notes" style={{ marginTop: 8 }} /></fieldset>
        <button className="btn btn-primary big" onClick={() => { if (validate()) setPreview(true); }}>Preview</button>
      </div> : <div className="stack-lg">
        <div className="card preview-card">
          <span className="lbl-sm">{groupById(f.groupId)!.name}</span>
          <h2>{f.title}</h2>
          <p><Icon name="cal" size={16} /> {fmtLong(f.date)}, {fmtTime(f.time)}</p>
          <p><Icon name="pin" size={16} /> {f.where} ({f.locType})</p>
          <p><Icon name="circles" size={16} /> {f.size}</p>
          {f.desc && <p>{f.desc}</p>}
          {(f.access.length > 0 || f.accessNote) && <div className="chips static">{[...f.access, ...(f.accessNote ? [f.accessNote] : [])].map(a => <span className="chip-static" key={a}>{a}</span>)}</div>}
        </div>
        <div className="btn-row"><button className="btn btn-secondary" onClick={() => setPreview(false)}>Edit</button><button className="btn btn-primary grow" onClick={post}>Post to circle</button></div>
      </div>}
    </Screen>
  );
}

export function Comfort() {
  const { s, update, toast } = useApp();
  const c = s.comfort;
  const tog = (pr: string) => update((d: any) => { const on = d.comfort.prefs.includes(pr); d.comfort.prefs = on ? d.comfort.prefs.filter((x: string) => x !== pr) : [...d.comfort.prefs, pr]; if (!on) d.comfort.show[pr] = true; });
  const shown = c.prefs.filter((x: string) => c.show[x]);
  return (
    <Screen title="Social comfort" sub="Tell people how you like to connect. You decide what they see." label="Circles">
      <div className="stack">{COMFORT_PREFS.map((pr, i) => (
        <div key={pr} className="comfort-item">
          <Choice on={c.prefs.includes(pr)} onClick={() => tog(pr)} title={pr} />
          {c.prefs.includes(pr) && <Toggle id={'show' + i} label="Show on my profile" on={!!c.show[pr]} onChange={(v: boolean) => update((d: any) => { d.comfort.show[pr] = v; })} />}
        </div>
      ))}</div>
      <section className="section"><h2>What others see</h2>
        <div className="card profile-preview">
          <Avatar name={s.profile.name || 'You'} size={48} tone="lav" />
          <div><strong>{s.profile.name || 'You'}</strong>{shown.length ? <ul>{shown.map((x: string) => <li key={x}>{x}</li>)}</ul> : <p className="hint">Nothing shared. That's fine too.</p>}</div>
        </div>
      </section>
    </Screen>
  );
}
