// Rumi prototype: core types, state, utilities and UI primitives
declare const React: any;
export const { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } = React;

// ---------- Types ----------
export type ThemeId = 'soft' | 'contrast' | 'low';
export interface Appt {
  id: string; kind: string; reason: string; provider: string;
  mode: 'in-person' | 'virtual'; date: string; time: string;
  accom: string[]; accomNote: string; sample?: boolean;
}
export interface Prep {
  reason: string; symptoms: string[]; questions: string[]; nervous: string[]; accom: string[]; other: string[];
  dump: string; saved?: string;
}
export interface Task { id: string; title: string; date: string; time: string; notes: string; done: boolean; remind: boolean; sample?: boolean }
export interface Contact { id: string; name: string; relation: string; phone: string; sample?: boolean }
export interface Msg { id: string; user: string; text: string; ts: number; reactions: Record<string, string[]>; replyTo?: string; sim?: boolean }
export interface Summary { id: string; title: string; date: string; sections: Record<string, { text: string; line?: number }[]>; source: string }
export interface Growth { id: string; type: string; label: string; date: string }

// ---------- Utilities ----------
export const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => isoOf(new Date());
export const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); };
export const nextWeekday = (wd: number) => { const d = new Date(); const diff = ((wd - d.getDay()) + 7) % 7 || 7; d.setDate(d.getDate() + diff); return isoOf(d); };
export const parseISO = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const fmtDate = (s: string) => s ? parseISO(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
export const fmtLong = (s: string) => parseISO(s).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
export const fmtTime = (t: string) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`; };
export const daysFromToday = (s: string) => Math.round((parseISO(s).getTime() - parseISO(todayISO()).getTime()) / 86400000);
export const relDay = (s: string) => { const d = daysFromToday(s); if (d === 0) return 'Today'; if (d === 1) return 'Tomorrow'; if (d > 1 && d < 7) return `In ${d} days`; if (d < 0) return 'Past'; return fmtDate(s); };
export const uid = () => Math.random().toString(36).slice(2, 9);
export const has = (t: string, words: string[]) => { const x = (t || '').toLowerCase(); return words.some(w => x.includes(w)); };
export const money = (n: number) => '$' + (Math.round(n * 100) / 100).toFixed(2);
export const initials = (n: string) => (n || '?').replace(/\(.*\)/, '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
export const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
export const CRISIS_WORDS = ['kill myself', 'suicide', 'suicidal', 'end my life', 'hurt myself', 'self harm', 'self-harm', 'want to die'];
export const isCrisis = (t: string) => has(t, CRISIS_WORDS);

// ---------- Storage ----------
const KEY = 'rumi.prototype.v1';
export let storageOK = true;
try { localStorage.setItem('rumi.t', '1'); localStorage.removeItem('rumi.t'); } catch (e) { storageOK = false; }
export function loadState() { try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch (e) { storageOK = false; return null; } }
export function saveState(s: any) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { storageOK = false; } }

export function prefersDark() { try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; } }
export function prefersReduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

export function makeDefault() {
  return {
    v: 1,
    onboarded: false,
    profile: { name: '', companion: 'Rumi', color: 'plum', input: 'both', detail: 'short', help: [] as string[], pronounce: '' },
    settings: {
      theme: (prefersDark() ? 'low' : 'soft') as ThemeId, fontScale: 1, reducedMotion: prefersReduced(), simplified: false, readAloud: true,
      notif: { appointments: true, meetups: true, tasks: false, encouragement: true },
      privacy: { shareGrowth: false, showOnline: false, analytics: false },
    },
    appointments: [
      { id: 'a-sample', kind: 'Primary care', reason: 'Yearly check-up', provider: 'Dr. Maya Lee (sample)', mode: 'in-person', date: addDays(4), time: '10:30', accom: ['Quiet waiting area', 'Explain each step first'], accomNote: '', sample: true },
    ] as Appt[],
    prep: {} as Record<string, Prep>,
    tasks: [
      { id: 't1', title: 'Reply to Sam about Saturday', date: todayISO(), time: '14:00', notes: '', done: false, remind: false, sample: true },
      { id: 't2', title: 'Clean my room', date: todayISO(), time: '', notes: 'Desk first.', done: false, remind: false, sample: true },
      { id: 't3', title: 'Do laundry', date: todayISO(), time: '18:30', notes: '', done: true, remind: false, sample: true },
    ] as Task[],
    contacts: [
      { id: 'c1', name: 'Priya (sample)', relation: 'Sister', phone: '(555) 010-2241', sample: true },
      { id: 'c2', name: 'Jordan (sample)', relation: 'Friend', phone: '(555) 010-7781', sample: true },
    ] as Contact[],
    summaries: [] as Summary[],
    recordings: [] as { id: string; date: string; secs: number; demo: boolean }[],
    joined: [] as string[],
    messages: {} as Record<string, Msg[]>,
    events: [] as any[],
    rsvps: {} as Record<string, string>,
    attended: [] as string[],
    checklists: {} as Record<string, string[]>,
    comfort: { prefs: ['I need time to respond.'], show: { 'I need time to respond.': true } as Record<string, boolean> },
    blocked: [] as string[],
    reports: [] as any[],
    growth: [] as Growth[],
    money: {
      budget: 120,
      purchases: [{ id: 'p1', label: 'Groceries', amount: 34.2, sample: true }, { id: 'p2', label: 'Bus pass top-up', amount: 15, sample: true }],
      bills: [{ id: 'b1', label: 'Phone plan', amount: 35, day: 12, recurring: true, sample: true }, { id: 'b2', label: 'Music streaming', amount: 10.99, day: 20, recurring: true, sample: true }],
    },
    dismissed: [] as string[],
    reflections: [] as { id: string; date: string; text: string }[],
  };
}
export type State = ReturnType<typeof makeDefault>;

export function mergeLoaded(loaded: any): State {
  const d: any = makeDefault();
  if (!loaded || loaded.v !== 1) return d;
  return {
    ...d, ...loaded,
    profile: { ...d.profile, ...loaded.profile },
    settings: { ...d.settings, ...loaded.settings, notif: { ...d.settings.notif, ...(loaded.settings || {}).notif }, privacy: { ...d.settings.privacy, ...(loaded.settings || {}).privacy } },
    money: { ...d.money, ...loaded.money },
    comfort: { ...d.comfort, ...loaded.comfort },
  };
}

// ---------- Context ----------
export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx) as any;

// ---------- Speech + clipboard ----------
export function canSpeak() { return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof (window as any).SpeechSynthesisUtterance === 'function'; }
// Whether Rumi is reading something aloud right now. Any screen can show a Stop control from this.
let speakingNow = false;
let speakId = 0;
const speakListeners = new Set<() => void>();
function setSpeaking(v: boolean) { if (speakingNow === v) return; speakingNow = v; speakListeners.forEach((f) => f()); }
export function stopSpeaking() { speakId++; try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { } setSpeaking(false); }
export function useSpeaking(): boolean {
  const [v, setV] = useState(speakingNow);
  useEffect(() => { const f = () => setV(speakingNow); speakListeners.add(f); f(); return () => { speakListeners.delete(f); }; }, []);
  return v;
}
export function speakText(text: string, toast: (m: string) => void) {
  if (!canSpeak()) { toast("Read aloud isn't supported in this browser."); return; }
  try {
    window.speechSynthesis.cancel();
    const id = ++speakId;
    const u = new (window as any).SpeechSynthesisUtterance(text); u.rate = 0.95;
    // Only the newest utterance may clear the flag (cancel() ends the previous one a moment later).
    u.onend = u.onerror = () => { if (id === speakId) setSpeaking(false); };
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }
  catch (e) { setSpeaking(false); toast("Read aloud isn't available here."); }
}
export function copyText(text: string, toast: (m: string) => void, el?: HTMLTextAreaElement | null) {
  const fallback = () => { if (el) { el.focus(); el.select(); } toast("Copy isn't available here. The text is selected so you can copy it yourself."); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast('Copied.'), fallback);
    else fallback();
  } catch (e) { fallback(); }
}

// ---------- Icons ----------
const IC: Record<string, string> = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  health: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/><path d="M5 11h3l1.5-2.5 3 5 1.5-2.5h5"/>',
  circles: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.2A5 5 0 0 1 21.5 19"/>',
  rescue: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.6 3.6M14.8 14.8l3.6 3.6M14.8 9.2l3.6-3.6M5.6 18.4l3.6-3.6"/>',
  you: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  cal: '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mic: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  play: '<path d="M7 4.5v15l12-7.5Z"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  bubble: '<path d="M21 12a8 8 0 0 1-11.8 7L3 21l2-5.6A8 8 0 1 1 21 12Z"/>',
  notes: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  end: '<path d="M3 14.5c5-4.7 13-4.7 18 0l-2.2 2.8-3.6-1.4v-2.6a10 10 0 0 0-6.4 0v2.6l-3.6 1.4Z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  flag: '<path d="M4 22V4M4 4h13l-2 4.5L17 13H4"/>',
  block: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  leave: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3.5v11L16 14"/>',
  rec: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  sparkle: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4Z"/><path d="M19 17v4M17 19h4"/>',
  bus: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 21v-3M16 21v-3"/><circle cx="8" cy="14.5" r=".9" fill="currentColor"/><circle cx="16" cy="14.5" r=".9" fill="currentColor"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-4a2 2 0 0 0 0 4h4v4a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
  sprout: '<path d="M12 21v-9"/><path d="M12 12C12 7.5 8.5 5 4 5c0 4.5 3 7 8 7Z"/><path d="M12 14c0-4 3-6.5 8-6.5 0 4-3 6.5-8 6.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
  contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  reply: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  wind: '<path d="M3 8h10a3 3 0 1 0-3-3M3 16h14a3 3 0 1 1-3 3M3 12h17"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  door: '<path d="M14 21V3H5v18M3 21h18M14 4l6 2v15"/><circle cx="11" cy="12" r=".9" fill="currentColor"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  tooth: '<path d="M7 3c-2.5 0-4 2-4 4.5 0 3 1.5 4.5 2 7 .5 3 1 6.5 2.5 6.5S9.5 17 12 17s2.5 4 4.5 4 2-3.5 2.5-6.5c.5-2.5 2-4 2-7C21 5 19.5 3 17 3c-2 0-3 1-5 1S9 3 7 3Z"/>',
  chat2: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2Z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  steth: '<path d="M5 3v6a5 5 0 0 0 10 0V3"/><path d="M10 14v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="12" r="2"/>',
};
export function Icon({ name, size = 22, className = '', label }: any) {
  return <svg className={'ic ' + className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label} dangerouslySetInnerHTML={{ __html: IC[name] || IC.info }} />;
}

// ---------- Mascot ----------
export const MASCOT_COLORS: Record<string, { body: string; glow: string; label: string }> = {
  plum: { body: '#C9BCE6', glow: '#E4DCF4', label: 'Lavender' },
  sage: { body: '#B4D8CA', glow: '#D8ECE4', label: 'Sage' },
  sky: { body: '#B6D2EA', glow: '#DAE9F5', label: 'Sky' },
  apricot: { body: '#F0CDA9', glow: '#F8E5D2', label: 'Apricot' },
};
export function Mascot({ size = 96, color = 'plum', mood = 'calm', className = '' }: any) {
  const c = MASCOT_COLORS[color] || MASCOT_COLORS.plum;
  return (
    <svg className={'mascot ' + className} width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <path d="M61 10c23 0 46 15 47 41 1 28-18 55-48 56-30 1-50-22-48-50 2-27 26-47 49-47Z" fill={c.body} />
      <ellipse cx="46" cy="36" rx="20" ry="12" fill={c.glow} opacity=".9" />
      <rect x="44" y="52" width="7" height={mood === 'happy' ? 6 : 11} rx="3.5" fill="#343345" />
      <rect x="69" y="52" width="7" height={mood === 'happy' ? 6 : 11} rx="3.5" fill="#343345" />
      <circle cx="38" cy="70" r="6" fill="#F2B9A6" opacity=".55" />
      <circle cx="82" cy="70" r="6" fill="#F2B9A6" opacity=".55" />
      <path d="M52 74c4 5 12 5 16 0" stroke="#343345" strokeWidth="3.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ---------- Primitives ----------
export function Sim({ children = 'Demo' }: any) { return <span className="sim"><Icon name="info" size={13} />{children}</span>; }

export function Screen({ title, sub, back = true, label, actions, children, bodyClass = '', titleSr }: any) {
  const { nav } = useApp();
  return (
    <div className="screen">
      <header className="topbar">
        {back ? <button className="icon-btn" onClick={nav.back} aria-label="Go back"><Icon name="back" /></button> : <span className="topbar-spacer" />}
        <span className="topbar-label">{label}</span>
        <div className="topbar-actions">{actions}</div>
      </header>
      <div className={'screen-body ' + bodyClass}>
        <h1 data-screen-title tabIndex={-1} className={titleSr ? 'sr-only' : ''}>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

export function Field({ id, label, hint, error, children, optional }: any) {
  return (
    <div className="field">
      <label className="lbl" htmlFor={id}>{label}{optional && <span className="opt"> (optional)</span>}</label>
      {hint && <p className="hint" id={id + '-hint'}>{hint}</p>}
      {children}
      {error && <p className="err" id={id + '-err'} role="alert"><Icon name="alert" size={16} />{error}</p>}
    </div>
  );
}

export function Chip({ on, onClick, children, icon }: any) {
  return <button type="button" className="chip" aria-pressed={!!on} onClick={onClick}>{on ? <Icon name="check" size={16} /> : icon ? <Icon name={icon} size={16} /> : null}{children}</button>;
}

export function Choice({ on, onClick, title, desc, icon, tone }: any) {
  return (
    <button type="button" className={'choice' + (tone ? ' tone-' + tone : '')} aria-pressed={!!on} onClick={onClick}>
      {icon && <span className="choice-ic"><Icon name={icon} /></span>}
      <span className="choice-text"><strong>{title}</strong>{desc && <span>{desc}</span>}</span>
      <span className="choice-mark" aria-hidden="true">{on ? <Icon name="check" size={18} /> : null}</span>
    </button>
  );
}

export function Toggle({ id, label, desc, on, onChange }: any) {
  return (
    <div className="toggle-row">
      <div className="toggle-text"><span className="toggle-label" id={id + '-l'}>{label}</span>{desc && <span className="hint">{desc}</span>}</div>
      <button id={id} type="button" role="switch" aria-checked={!!on} aria-labelledby={id + '-l'} className="switch" onClick={() => onChange(!on)}>
        <span className="switch-knob" /><span className="switch-state">{on ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}

export function Segmented({ value, options, onChange, label }: any) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o: any) => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Row({ icon, title, desc, onClick, right, tone }: any) {
  return (
    <button type="button" className="row" onClick={onClick}>
      {icon && <span className={'row-ic' + (tone ? ' bg-' + tone : '')}><Icon name={icon} size={20} /></span>}
      <span className="row-text"><strong>{title}</strong>{desc && <span>{desc}</span>}</span>
      {right !== undefined ? right : <Icon name="chev" size={18} className="muted" />}
    </button>
  );
}

export function Empty({ icon, title, body, action }: any) {
  return <div className="empty"><span className="empty-ic"><Icon name={icon} size={26} /></span><strong>{title}</strong>{body && <p>{body}</p>}{action}</div>;
}

export function ReadAloud({ text, label = 'Read aloud', small }: any) {
  const { s, speak } = useApp();
  const speaking = useSpeaking();
  if (!s.settings.readAloud) return null;
  return <button type="button" className={'btn btn-ghost' + (small ? ' btn-sm' : '')} onClick={() => (speaking ? stopSpeaking() : speak(text))}><Icon name={speaking ? 'stop' : 'volume'} size={18} />{speaking ? 'Stop reading' : label}</button>;
}

export function Sheet({ title, onClose, children }: any) {
  const ref = useRef(null);
  useEffect(() => {
    const el: any = ref.current; if (el) { const f = el.querySelector('button, input, textarea, select'); f && f.focus(); }
    const k = (e: any) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="sheet-backdrop" onClick={(e: any) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="sheet-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  );
}

export function Avatar({ name, size = 36, tone }: any) {
  const tones = ['lav', 'sage', 'blue', 'apricot'];
  const t = tone || tones[(name || '').split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0) % 4];
  return <span className={'avatar bg-' + t} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">{initials(name)}</span>;
}

export function addGrowth(d: any, type: string, label: string) {
  d.growth.unshift({ id: uid(), type, label, date: todayISO() });
}
