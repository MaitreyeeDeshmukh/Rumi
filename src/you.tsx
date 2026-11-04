import { useState, useApp, Screen, Icon, Field, Chip, Choice, Toggle, Segmented, Row, Empty, Mascot, MASCOT_COLORS, Avatar, Sim, fmtDate, uid, storageOK, makeDefault } from './core';

export const THEMES = [
  { id: 'soft', name: 'Soft Focus', desc: 'Warm and muted. The default.', icon: 'sun' },
  { id: 'contrast', name: 'High Contrast', desc: 'Stronger text and borders.', icon: 'contrast' },
  { id: 'low', name: 'Low Light', desc: 'Dark and gentle on the eyes.', icon: 'moon' },
];
export function ThemePicker() {
  const { s, update } = useApp();
  return (
    <div className="theme-grid" role="group" aria-label="Display theme">
      {THEMES.map(t => (
        <button key={t.id} className="theme-opt" aria-pressed={s.settings.theme === t.id} onClick={() => update((d: any) => { d.settings.theme = t.id; })}>
          <span className={'theme-swatch sw-' + t.id} aria-hidden="true"><i /><i /><i /></span>
          <span className="row-text"><strong>{t.name}</strong><span>{t.desc}</span></span>
          <span className="choice-mark" aria-hidden="true">{s.settings.theme === t.id && <Icon name="check" size={18} />}</span>
        </button>
      ))}
    </div>
  );
}

export function YouHome() {
  const { s, nav } = useApp();
  return (
    <Screen title={s.profile.name || 'You'} sub={`Your companion is ${s.profile.companion}.`} back={false} label="You" titleSr={false}>
      <div className="you-head card">
        <Mascot size={64} color={s.profile.color} />
        <div><strong>{s.profile.companion}</strong><span className="muted">Your companion · {MASCOT_COLORS[s.profile.color].label}</span></div>
        <button className="btn btn-secondary btn-sm" onClick={() => nav.push('profile')}>Edit</button>
      </div>
      <section className="section"><h2>Settings</h2>
        <div className="list">
          <Row icon="you" tone="lav" title="Profile and companion" desc="Your name, companion name and look" onClick={() => nav.push('profile')} />
          <Row icon="bubble" tone="sage" title="Communication" desc={`${s.profile.input === 'listen' ? 'Listening' : s.profile.input === 'read' ? 'Reading' : 'Reading and listening'} · ${s.profile.detail === 'detailed' ? 'More detail' : 'Short explanations'}`} onClick={() => nav.push('comm')} />
          <Row icon="eye" tone="blue" title="Accessibility" desc="Text size, motion, simplified view" onClick={() => nav.push('access')} />
          <Row icon="contrast" tone="apricot" title="Display theme" desc={THEMES.find(t => t.id === s.settings.theme)!.name} onClick={() => nav.push('theme')} />
          <Row icon="phone" tone="sage" title="Trusted contacts" desc={`${s.contacts.length} ${s.contacts.length === 1 ? 'person' : 'people'}`} onClick={() => nav.push('contacts')} />
          <Row icon="lock" tone="lav" title="Privacy" desc="What's shared and who's blocked" onClick={() => nav.push('privacy')} />
          <Row icon="notes" tone="blue" title="Your data" desc="Export, clear or restart" onClick={() => nav.push('data')} />
        </div>
      </section>
      <section className="section"><h2>My Growth</h2>
        <Row icon="sprout" tone="sage" title="My Growth" desc={s.growth.length ? `${s.growth.length} private ${s.growth.length === 1 ? 'moment' : 'moments'}` : 'Things you tried, kept private'} onClick={() => nav.push('growth')} />
      </section>
    </Screen>
  );
}

export function ProfileEdit() {
  const { s, update, toast } = useApp();
  const [name, setName] = useState(s.profile.name);
  const [comp, setComp] = useState(s.profile.companion);
  const [err, setErr] = useState('');
  return (
    <Screen title="Profile and companion" label="You">
      <div className="stack-lg">
        <Field id="pname" label="What should Rumi call you?"><input id="pname" className="input" value={name} onChange={(e: any) => setName(e.target.value)} /></Field>
        <Field id="pcomp" label="Companion name" error={err}><input id="pcomp" className="input" value={comp} onChange={(e: any) => { setComp(e.target.value); setErr(''); }} /></Field>
        <div className="chips">{['Rumi', 'Mochi', 'Nori', 'Kiki', 'Sunny'].map(n => <Chip key={n} on={comp === n} onClick={() => setComp(n)}>{n}</Chip>)}</div>
        <fieldset className="field"><legend className="lbl">Companion color</legend>
          <div className="mascot-pick">{Object.entries(MASCOT_COLORS).map(([k, v]) => <button key={k} aria-pressed={s.profile.color === k} onClick={() => update((d: any) => { d.profile.color = k; })}><Mascot size={56} color={k} /><span>{v.label}</span></button>)}</div>
        </fieldset>
        <button className="btn btn-primary" onClick={() => { if (!comp.trim()) { setErr('Your companion needs a name.'); return; } update((d: any) => { d.profile.name = name.trim(); d.profile.companion = comp.trim().slice(0, 20); }); toast('Profile saved.'); }}>Save</button>
      </div>
    </Screen>
  );
}

export function CommPrefs() {
  const { s, update } = useApp();
  const set = (k: string, v: any) => update((d: any) => { d.profile[k] = v; });
  return (
    <Screen title="Communication" sub="Rumi adapts how it explains things." label="You">
      <fieldset className="field"><legend className="lbl">How do you like to take in information?</legend>
        <div className="stack">
          <Choice on={s.profile.input === 'read'} onClick={() => set('input', 'read')} icon="notes" title="Reading" />
          <Choice on={s.profile.input === 'listen'} onClick={() => set('input', 'listen')} icon="volume" title="Listening" desc="Read-aloud buttons stay visible" />
          <Choice on={s.profile.input === 'both'} onClick={() => set('input', 'both')} icon="bubble" title="Both" />
        </div>
      </fieldset>
      <fieldset className="field"><legend className="lbl">How much detail?</legend>
        <div className="stack">
          <Choice on={s.profile.detail === 'short'} onClick={() => set('detail', 'short')} title="Short explanations" desc="Just the step" />
          <Choice on={s.profile.detail === 'detailed'} onClick={() => set('detail', 'detailed')} title="More detailed explanations" desc="Steps include a bit of why and how" />
        </div>
      </fieldset>
      <fieldset className="field"><legend className="lbl">What would you like help with?</legend>
        <div className="chips">{HELP_CATS.map(c => <Chip key={c} on={s.profile.help.includes(c)} onClick={() => update((d: any) => { d.profile.help = d.profile.help.includes(c) ? d.profile.help.filter((x: string) => x !== c) : [...d.profile.help, c]; })}>{c}</Chip>)}</div>
      </fieldset>
    </Screen>
  );
}
export const HELP_CATS = ['Healthcare appointments', 'Meeting new people', 'Everyday planning', 'Unexpected situations', 'Communication', 'Money and budgeting'];

export function Accessibility() {
  const { s, update } = useApp();
  const st = s.settings;
  const set = (k: string, v: any) => update((d: any) => { d.settings[k] = v; });
  return (
    <Screen title="Accessibility" sub="Changes apply right away." label="You">
      <fieldset className="field"><legend className="lbl">Text size</legend>
        <Segmented label="Text size" value={st.fontScale} onChange={(v: number) => set('fontScale', v)} options={[{ value: 0.9, label: 'Small' }, { value: 1, label: 'Default' }, { value: 1.15, label: 'Large' }, { value: 1.3, label: 'Largest' }]} />
      </fieldset>
      <div className="card preview-text"><span className="lbl-sm">Preview</span><p>Your world. Your pace. Your way.</p></div>
      <div className="toggles">
        <Toggle id="rm" label="Reduce motion" desc="Turns off movement and transitions" on={st.reducedMotion} onChange={(v: boolean) => set('reducedMotion', v)} />
        <Toggle id="simp" label="Simplified interface" desc="Fewer cards, bigger buttons, less on each screen" on={st.simplified} onChange={(v: boolean) => set('simplified', v)} />
        <Toggle id="ra" label="Show read-aloud buttons" desc="Only plays when you tap. No surprise sounds." on={st.readAloud} onChange={(v: boolean) => set('readAloud', v)} />
      </div>
      <section className="section"><div className="section-head"><h2>Notifications</h2><Sim>Simulated</Sim></div>
        <p className="hint">This preview doesn't send notifications. These choices show what you'd control.</p>
        <div className="toggles">
          {[['appointments', 'Appointment reminders'], ['meetups', 'Meetup reminders'], ['tasks', 'Task reminders'], ['encouragement', 'Gentle encouragement on Home']].map(([k, l]) => <Toggle key={k} id={'n' + k} label={l} on={st.notif[k]} onChange={(v: boolean) => update((d: any) => { d.settings.notif[k] = v; })} />)}
        </div>
      </section>
      <section className="section"><h2>Display theme</h2><ThemePicker /></section>
    </Screen>
  );
}

export function ThemeScreen() {
  return <Screen title="Display theme" sub="Pick what feels comfortable. You can change it any time." label="You"><ThemePicker /><p className="fineprint"><Icon name="info" size={14} />Themes are about comfort and preference. Every theme meets WCAG AA contrast for text.</p></Screen>;
}

export function Contacts() {
  const { s, update, toast } = useApp();
  const [f, setF] = useState({ name: '', relation: '', phone: '' });
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(s.contacts.length === 0);
  return (
    <Screen title="Trusted contacts" sub="People you might want to reach quickly or share summaries with." label="You">
      <div className="list">{s.contacts.map((c: any) => <div key={c.id} className="row static"><Avatar name={c.name} size={40} /><span className="row-text"><strong>{c.name}</strong><span>{c.relation} · <span className="select-all">{c.phone}</span></span></span><button className="icon-btn" aria-label={`Remove ${c.name}`} onClick={() => { update((d: any) => { d.contacts = d.contacts.filter((x: any) => x.id !== c.id); }); toast(`${c.name} removed.`); }}><Icon name="trash" size={18} /></button></div>)}</div>
      {s.contacts.length === 0 && !adding && <Empty icon="phone" title="No trusted contacts" />}
      {adding ? <div className="card stack" style={{ marginTop: 14 }}>
        <Field id="cn" label="Name"><input id="cn" className="input" value={f.name} onChange={(e: any) => setF({ ...f, name: e.target.value })} /></Field>
        <Field id="cr" label="Relationship" optional><input id="cr" className="input" value={f.relation} onChange={(e: any) => setF({ ...f, relation: e.target.value })} placeholder="Friend, parent, support worker" /></Field>
        <Field id="cp" label="Phone number"><input id="cp" className="input" inputMode="tel" value={f.phone} onChange={(e: any) => setF({ ...f, phone: e.target.value })} /></Field>
        {err && <p className="err" role="alert"><Icon name="alert" size={16} />{err}</p>}
        <div className="btn-row">{s.contacts.length > 0 && <button className="btn btn-secondary" onClick={() => setAdding(false)}>Cancel</button>}<button className="btn btn-primary grow" onClick={() => { if (!f.name.trim() || f.phone.replace(/\D/g, '').length < 7) { setErr('Add a name and a phone number with at least 7 digits.'); return; } update((d: any) => { d.contacts.push({ id: uid(), name: f.name.trim(), relation: f.relation.trim() || 'Trusted contact', phone: f.phone.trim() }); }); setF({ name: '', relation: '', phone: '' }); setErr(''); setAdding(false); toast('Contact saved on this device.'); }}>Save contact</button></div>
      </div> : <button className="btn btn-secondary" style={{ marginTop: 14 }} onClick={() => setAdding(true)}><Icon name="plus" size={18} />Add someone</button>}
      <p className="fineprint"><Icon name="lock" size={14} />Contacts stay on this device. Rumi never messages them without you.</p>
    </Screen>
  );
}

export function Privacy() {
  const { s, nav, update, toast } = useApp();
  const pv = s.settings.privacy;
  return (
    <Screen title="Privacy" label="You">
      <div className="toggles">
        <Toggle id="pg" label="Share My Growth with trusted contacts" desc="Off means only you can see it" on={pv.shareGrowth} onChange={(v: boolean) => update((d: any) => { d.settings.privacy.shareGrowth = v; })} />
        <Toggle id="po" label="Show when I'm active in Circles" on={pv.showOnline} onChange={(v: boolean) => update((d: any) => { d.settings.privacy.showOnline = v; })} />
        <Toggle id="pa" label="Share anonymous usage data" desc="Helps improve Rumi. Not collected in this preview." on={pv.analytics} onChange={(v: boolean) => update((d: any) => { d.settings.privacy.analytics = v; })} />
      </div>
      <Row icon="sliders" title="What others see in Circles" onClick={() => nav.push('comfort', {}, 'circles')} />
      <section className="section"><h2>Blocked members</h2>
        {s.blocked.length === 0 ? <p className="hint">You haven't blocked anyone.</p> : <div className="list">{s.blocked.map((b: string) => <div key={b} className="row static"><Avatar name={b} size={36} /><span className="row-text"><strong>{b}</strong></span><button className="btn btn-ghost btn-sm" onClick={() => { update((d: any) => { d.blocked = d.blocked.filter((x: string) => x !== b); }); toast(`${b} unblocked.`); }}>Unblock</button></div>)}</div>}
      </section>
      <section className="section"><h2>Your reports</h2>
        {s.reports.length === 0 ? <p className="hint">No reports.</p> : <div className="list">{s.reports.map((r: any) => <div key={r.id} className="row static"><span className="row-ic"><Icon name="flag" size={18} /></span><span className="row-text"><strong>{r.reason}</strong><span>About {r.target} · {fmtDate(r.date)} · saved locally, not reviewed</span></span></div>)}</div>}
      </section>
    </Screen>
  );
}

export function DataControls() {
  const { s, nav, update, toast, resetAll } = useApp();
  const [confirm, setConfirm] = useState('');
  const json = JSON.stringify(s, null, 2);
  return (
    <Screen title="Your data" label="You">
      <div className={'notice' + (storageOK ? '' : ' warn')}><Icon name={storageOK ? 'lock' : 'alert'} size={18} /><span>{storageOK ? 'Everything is saved only in this browser on this device. Nothing is sent to a server.' : "Saving on this device isn't available here, so changes last until you close this page."}</span></div>
      <div className="list" style={{ marginTop: 14 }}>
        <Row icon="repeat" title="Restart onboarding" desc="Keeps your data, walks through setup again" onClick={() => { update((d: any) => { d.onboarded = false; }); }} />
        <Row icon="trash" title="Remove sample content" desc="Deletes demo tasks, appointments and contacts" onClick={() => setConfirm('sample')} right={null} />
        <Row icon="trash" title="Clear all demo data" desc="Resets Rumi to a fresh start" onClick={() => setConfirm('all')} right={null} />
      </div>
      {confirm && <div className="confirm-box"><p>{confirm === 'all' ? 'Clear everything and start over? This cannot be undone.' : 'Remove all items marked as sample?'}</p><div className="btn-row"><button className="btn btn-secondary" onClick={() => setConfirm('')}>Cancel</button><button className="btn btn-danger grow" onClick={() => {
        if (confirm === 'all') { resetAll(); toast('All data cleared.'); }
        else { update((d: any) => { d.appointments = d.appointments.filter((x: any) => !x.sample); d.tasks = d.tasks.filter((x: any) => !x.sample); d.contacts = d.contacts.filter((x: any) => !x.sample); d.money.purchases = d.money.purchases.filter((x: any) => !x.sample); d.money.bills = d.money.bills.filter((x: any) => !x.sample); }); toast('Sample content removed.'); }
        setConfirm('');
      }}>{confirm === 'all' ? 'Clear everything' : 'Remove samples'}</button></div></div>}
      <section className="section"><h2>Export</h2><p className="hint">A copy of everything Rumi stores, in JSON.</p>
        <textarea className="input mono" rows={8} readOnly value={json} aria-label="Your data as JSON" onFocus={(e: any) => e.target.select()} />
      </section>
    </Screen>
  );
}

const GROWTH_LABELS: Record<string, { label: string; icon: string; tone: string }> = {
  practice: { label: 'Practiced a conversation', icon: 'video', tone: 'sage' },
  prep: { label: 'Prepared for an appointment', icon: 'notes', tone: 'lav' },
  task: { label: 'Completed a task', icon: 'check', tone: 'blue' },
  meetup: { label: 'Attended a meetup', icon: 'circles', tone: 'apricot' },
};
export function GrowthScreen() {
  const { s } = useApp();
  return (
    <Screen title="My Growth" sub="A private record of things you tried. No streaks, no scores." label="You">
      <div className="growth-grid">{Object.entries(GROWTH_LABELS).map(([k, v]) => { const n = s.growth.filter((g: any) => g.type === k).length; return <div key={k} className={'growth-tile bg-' + v.tone}><Icon name={v.icon} size={22} /><strong>{n}</strong><span>{v.label}</span></div>; })}</div>
      <section className="section"><h2>History</h2>
        {s.growth.length === 0 ? <Empty icon="sprout" title="Nothing here yet" body="When you practice, prepare, finish a task or go to a meetup, it shows up here. Only if you want it to count." /> :
          <ol className="history">{s.growth.map((g: any) => <li key={g.id}><span className={'row-ic bg-' + GROWTH_LABELS[g.type].tone}><Icon name={GROWTH_LABELS[g.type].icon} size={16} /></span><span className="row-text"><strong>{g.label}</strong><span>{fmtDate(g.date)}</span></span></li>)}</ol>}
      </section>
      {s.reflections.length > 0 && <section className="section"><h2>Notes to self</h2><div className="stack">{s.reflections.map((r: any) => <div key={r.id} className="card"><span className="lbl-sm">{fmtDate(r.date)}</span><p style={{ margin: '4px 0 0' }}>{r.text}</p></div>)}</div></section>}
    </Screen>
  );
}
