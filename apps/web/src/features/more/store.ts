"use client";

/**
 * Local state for the preview tools under /home/<feature> (visits, appointments, circles, contacts, growth,
 * rescue, my day, money). It lives in its own localStorage key so it never touches the main Rumi state
 * (rumi.v1). Reading never throws: a bad or missing field falls back to its empty value.
 */
import { useSyncExternalStore } from "react";

export const MORE_KEY = "rumi.more.v1";

export type Visit = { id: string; title: string; date: string; minutes: number; apptId?: string };
export type Appointment = {
  id: string;
  kind: string;
  provider: string;
  date: string;
  time: string;
  mode: "in_person" | "virtual";
  reason: string;
  accom: string[];
  /** True when the time is booked; false when the person still needs to call. */
  booked: boolean;
  done: boolean;
};
export type Contact = { id: string; name: string; relation: string; phone: string; how: "text" | "call" };
export type Win = { id: string; text: string; date: string };
export type Step = { text: string; done: boolean };
export type Task = { id: string; text: string; date: string; done: boolean; steps: Step[] };
export type Spend = { id: string; cents: number; category: string; note: string; date: string };
export type SentMessage = { id: string; text: string; ts: number; mine: boolean };
export type Circles = {
  joined: string[];
  going: string[];
  sent: Record<string, SentMessage[]>;
  comfort: string[];
  reported: string[];
  prepDone: Record<string, string[]>;
};

export type MoreState = {
  version: 1;
  visits: Visit[];
  appointments: Appointment[];
  contacts: Contact[];
  wins: Win[];
  tasks: Task[];
  spends: Spend[];
  /** Weekly budget for Money Mirror, in cents. 0 means not set. */
  budgetCents: number;
  circles: Circles;
};

export const emptyMore = (): MoreState => ({
  version: 1,
  visits: [],
  appointments: [],
  contacts: [],
  wins: [],
  tasks: [],
  spends: [],
  budgetCents: 0,
  circles: { joined: [], going: [], sent: {}, comfort: [], reported: [], prepDone: {} },
});

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.slice(0, max) : "");
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : []);
const list = <T,>(v: unknown, one: (x: Record<string, unknown>) => T | null): T[] =>
  Array.isArray(v) ? v.flatMap((x) => (isObj(x) ? [one(x)].filter((y): y is T => y !== null) : [])).slice(0, 500) : [];

/** Turns whatever is stored into a valid MoreState, one field at a time. */
export function parseMore(raw: unknown): MoreState {
  const base = emptyMore();
  if (!isObj(raw) || raw.version !== 1) return base;
  const c = isObj(raw.circles) ? raw.circles : {};
  const sent: Record<string, SentMessage[]> = {};
  if (isObj(c.sent)) {
    for (const [k, v] of Object.entries(c.sent)) {
      sent[k] = list(v, (m) =>
        str(m.id) && str(m.text) ? { id: str(m.id), text: str(m.text, 1000), ts: Number(m.ts) || 0, mine: m.mine === true } : null,
      );
    }
  }
  const prepDone: Record<string, string[]> = {};
  if (isObj(c.prepDone)) for (const [k, v] of Object.entries(c.prepDone)) prepDone[k] = strList(v);
  return {
    version: 1,
    visits: list(raw.visits, (v) =>
      str(v.id) ? { id: str(v.id), title: str(v.title), date: str(v.date, 10), minutes: Number(v.minutes) || 0, apptId: str(v.apptId) || undefined } : null,
    ),
    appointments: list(raw.appointments, (a) =>
      str(a.id)
        ? {
            id: str(a.id),
            kind: str(a.kind),
            provider: str(a.provider),
            date: str(a.date, 10),
            time: str(a.time, 5),
            mode: a.mode === "virtual" ? "virtual" : "in_person",
            reason: str(a.reason, 1000),
            accom: strList(a.accom),
            booked: a.booked !== false,
            done: a.done === true,
          }
        : null,
    ),
    contacts: list(raw.contacts, (p) =>
      str(p.id) && str(p.name)
        ? { id: str(p.id), name: str(p.name, 80), relation: str(p.relation, 80), phone: str(p.phone, 40), how: p.how === "call" ? "call" : "text" }
        : null,
    ),
    wins: list(raw.wins, (w) => (str(w.id) && str(w.text) ? { id: str(w.id), text: str(w.text, 300), date: str(w.date, 10) } : null)),
    tasks: list(raw.tasks, (t) =>
      str(t.id) && str(t.text)
        ? {
            id: str(t.id),
            text: str(t.text, 200),
            date: str(t.date, 10),
            done: t.done === true,
            steps: list(t.steps, (s) => (str(s.text) ? { text: str(s.text, 300), done: s.done === true } : null)),
          }
        : null,
    ),
    spends: list(raw.spends, (s) =>
      str(s.id) && Number.isFinite(Number(s.cents))
        ? { id: str(s.id), cents: Math.max(0, Math.round(Number(s.cents))), category: str(s.category, 40), note: str(s.note, 120), date: str(s.date, 10) }
        : null,
    ),
    budgetCents: Number.isFinite(Number(raw.budgetCents)) ? Math.max(0, Math.round(Number(raw.budgetCents))) : 0,
    circles: {
      joined: strList(c.joined),
      going: strList(c.going),
      sent,
      comfort: strList(c.comfort),
      reported: strList(c.reported),
      prepDone,
    },
  };
}

const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

let cache: MoreState | null = null;
const listeners = new Set<() => void>();

function load(): MoreState {
  if (cache) return cache;
  try {
    const text = storage()?.getItem(MORE_KEY);
    cache = parseMore(text ? JSON.parse(text) : null);
  } catch {
    cache = emptyMore();
  }
  return cache;
}

function save(next: MoreState): void {
  cache = next;
  try {
    storage()?.setItem(MORE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the change still shows for this visit.
  }
  listeners.forEach((l) => l());
}

export const moreStore = {
  get: load,
  update(fn: (s: MoreState) => MoreState): void {
    save(fn(load()));
  },
  erase(): void {
    try {
      storage()?.removeItem(MORE_KEY);
    } catch {
      // nothing stored
    }
    cache = emptyMore();
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** The preview state, or null before the browser has read it (server render and first paint). */
export function useMore(): MoreState | null {
  return useSyncExternalStore(moreStore.subscribe, moreStore.get, () => null);
}

export const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Today as YYYY-MM-DD in local time. */
export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const addDaysIso = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** "Monday, November 9" for a YYYY-MM-DD date. Empty for a bad date. */
export function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** "3:30 PM" for a 24-hour HH:MM time. */
export function clockTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
