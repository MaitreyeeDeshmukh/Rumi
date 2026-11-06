// Pure helpers for the appointments screens: the made-up providers, the slots, the booking, the call script, the
// calendar file and the transcript lines. No React, no storage. Nothing here talks to an office.
import { APPT } from "@/content/appointments";
import type { Appointment, CareType, TranscriptLine } from "@/features/shared/types";

export const CARE_KEYS = ["primary", "specialist", "dentist", "mental", "other"] as const satisfies readonly CareType[];

export interface Provider {
  id: string;
  name: string;
  clinic: string;
  care: Exclude<CareType, "other">;
  times: readonly string[];
}

/** Made-up people and places. Nobody here is real. The screens say so. */
export const PROVIDERS: readonly Provider[] = [
  { id: "lee", name: "Dr. Maya Lee", clinic: "Northside Health Center", care: "primary", times: ["09:00", "10:30", "14:00"] },
  { id: "okafor", name: "Dr. Sam Okafor", clinic: "Riverbend Clinic", care: "primary", times: ["08:30", "11:00", "15:30"] },
  { id: "ruiz", name: "Dr. Ana Ruiz", clinic: "Lakeview Specialists", care: "specialist", times: ["09:30", "13:00", "16:00"] },
  { id: "chen", name: "Dr. Wei Chen", clinic: "Hill Street Specialty Group", care: "specialist", times: ["10:00", "12:30", "14:30"] },
  { id: "park", name: "Dr. Jo Park", clinic: "Bright Smile Dental", care: "dentist", times: ["08:00", "10:00", "15:00"] },
  { id: "ahmed", name: "Dr. Lena Ahmed", clinic: "Quiet Mind Counseling", care: "mental", times: ["11:00", "13:30", "17:00"] },
];

/** The providers for one kind of care. "Other" shows everyone. */
export const providersFor = (care: CareType): readonly Provider[] =>
  care === "other" ? PROVIDERS : PROVIDERS.filter((p) => p.care === care);

const pad = (n: number): string => String(n).padStart(2, "0");
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDate = (date: string): Date => new Date(`${date}T00:00:00`);

export interface Slot {
  date: string;
  time: string;
}

/** The next five weekdays after `from`, each with the provider's three times. */
export function slotsFor(provider: Provider, from: Date): Slot[] {
  const out: Slot[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (out.length < 5 * provider.times.length) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    for (const time of provider.times) out.push({ date: isoDate(d), time });
  }
  return out;
}

/** Monday, November 9. */
export const dayLong = (date: string): string =>
  localDate(date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
/** Mon, Nov 9. */
export const dayShort = (date: string): string =>
  localDate(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
/** 14:00 gives "2:00 pm". */
export function timeText(time: string): string {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${h < 12 ? "am" : "pm"}`;
}

export interface BookingInput {
  care: CareType;
  provider: Provider;
  slot: Slot;
  reason: string;
}

/** The saved appointment. Status starts at "to_confirm" because Rumi never contacts the office. */
export function buildAppointment(input: BookingInput, id: string, now: Date): Appointment {
  return {
    id,
    care: input.care,
    providerName: input.provider.name,
    clinic: input.provider.clinic,
    date: input.slot.date,
    time: input.slot.time,
    reason: input.reason.trim().slice(0, 200),
    status: "to_confirm",
    createdAt: now.toISOString(),
    questions: [],
    bring: [],
    symptoms: [],
  };
}

/** What to say when you phone the office. Short sentences, filled from the appointment. */
export function callScript(a: Appointment, name: string): string {
  const lines = [
    `Hi, my name is ${name.trim() || "[your name]"}.`,
    `I would like to book a ${APPT.care[a.care].toLowerCase()} visit with ${a.providerName} at ${a.clinic}.`,
    `Is ${dayLong(a.date)} at ${timeText(a.time)} open?`,
  ];
  if (a.reason.trim()) lines.push(`The visit is about this: ${a.reason.trim().replace(/[.!?]+$/, "")}.`);
  lines.push("Please say the day and time again so I can write it down.");
  return lines.join("\n");
}

const icsStamp = (date: string, time: string, plusMinutes = 0): string => {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const d = localDate(date);
  d.setHours(h, m + plusMinutes);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
};
const icsText = (s: string): string => s.replace(/[\\;,]/g, (c) => "\\" + c).replace(/\r?\n/g, "\\n");

/** A one-hour calendar file in the person's own time zone. The reminder is the person's: the office has not confirmed. */
export function icsFor(a: Appointment, now: Date): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Rumi//Appointments//EN",
    "BEGIN:VEVENT",
    `UID:${a.id}@rumi.invalid`,
    `DTSTAMP:${now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`,
    `DTSTART:${icsStamp(a.date, a.time)}`,
    `DTEND:${icsStamp(a.date, a.time, 60)}`,
    `SUMMARY:${icsText(`${APPT.care[a.care]} visit with ${a.providerName}`)}`,
    `LOCATION:${icsText(a.clinic)}`,
    `DESCRIPTION:${icsText(`Confirm this time with the office. ${a.reason}`.trim())}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** Local "YYYY-MM-DDTHH:MM" strings compare in time order. */
const stamp = (a: Appointment): string => `${a.date}T${a.time}`;
const nowStamp = (now: Date): string => `${isoDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

/** Upcoming first (soonest first), then past (latest first). */
export function splitAppointments(list: readonly Appointment[], now: Date): { upcoming: Appointment[]; past: Appointment[] } {
  const n = nowStamp(now);
  const upcoming = list.filter((a) => stamp(a) >= n).sort((x, y) => stamp(x).localeCompare(stamp(y)));
  const past = list.filter((a) => stamp(a) < n).sort((x, y) => stamp(y).localeCompare(stamp(x)));
  return { upcoming, past };
}

/**
 * Turns what was said at a visit into recap lines. Sentences are grouped up to 400 characters, at most 60 lines.
 * The recording has one voice, so every line is marked A (the clinician side).
 */
export function transcriptLines(text: string, maxLines = 60, maxChars = 400): TranscriptLine[] {
  const sentences = text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  for (const s of sentences) {
    const last = chunks.length - 1;
    if (last >= 0 && chunks[last]!.length + 1 + s.length <= maxChars) chunks[last] += ` ${s}`;
    else chunks.push(s.slice(0, maxChars));
  }
  return chunks.slice(0, maxLines).map((t, i) => ({ id: `v${i + 1}`, speaker: "A", text: t }));
}

/** A new id that fits the storage rule (letters, digits, - and _, up to 40). */
export const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
