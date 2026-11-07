/**
 * Reading a letter without a model: dates, times, a doctor, a clinic, an address, and the lines after "bring".
 * It is the fallback when the AI is down and the answer under MOCK_AI. It finds less than the model does, and
 * the confirm screen shows the person exactly what it found.
 */
import type { ScanFieldsT } from "@/features/shared/schemas";
import { isoDate } from "@/features/appointments/appointments";
import { validIsoDate } from "@/features/appointmentScan/ground";
import { normalizeText } from "@/lib/text/tokens";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number): string => String(n).padStart(2, "0");

/** A day without a year means the next time that day comes. */
function withYear(month: number, day: number, year: number | undefined, today: Date): string {
  if (year !== undefined) return `${year}-${pad(month)}-${pad(day)}`;
  const thisYear = `${today.getFullYear()}-${pad(month)}-${pad(day)}`;
  return thisYear >= isoDate(today) ? thisYear : `${today.getFullYear() + 1}-${pad(month)}-${pad(day)}`;
}

function findDate(text: string, today: Date): string {
  const t = normalizeText(text);
  const monthRe = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const year = (y?: string): number | undefined => (y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : undefined);
  const monthNo = (m: string): number => MONTHS.indexOf(m.slice(0, 3).toLowerCase()) + 1;
  const tries: Array<() => string> = [
    () => {
      const m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
    },
    () => {
      const m = new RegExp(`\\b${monthRe}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "i").exec(t);
      return m ? withYear(monthNo(m[1]!), Number(m[2]), year(m[3]), today) : "";
    },
    () => {
      const m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${monthRe}\\.?(?:,?\\s+(\\d{4}))?\\b`, "i").exec(t);
      return m ? withYear(monthNo(m[2]!), Number(m[1]), year(m[3]), today) : "";
    },
    () => {
      // 11/16/2026 is read as month first, as a US letter writes it.
      const m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
      return m ? withYear(Number(m[1]), Number(m[2]), year(m[3]), today) : "";
    },
  ];
  for (const f of tries) {
    const iso = f();
    if (validIsoDate(iso)) return iso;
  }
  return "";
}

function findTime(text: string): string {
  const t = normalizeText(text);
  const ampm = /\b(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s?m\b/i.exec(t);
  if (ampm) {
    let h = Number(ampm[1]);
    if (h < 1 || h > 12) return "";
    h = (h % 12) + (ampm[3]!.toLowerCase() === "p" ? 12 : 0);
    return `${pad(h)}:${ampm[2] ?? "00"}`;
  }
  const h24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(t);
  return h24 ? `${pad(Number(h24[1]))}:${h24[2]}` : "";
}

const CLINIC_RE = /\b(?:clinic|hospital|medical|health|center|centre|specialists|dental|counseling|practice|associates|group)\b/i;
const STREET = "(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl)";
const ADDRESS_RE = new RegExp(
  String.raw`\b\d{1,6}\s+(?:[A-Za-z0-9'.-]+\s+){1,4}${STREET}\b\.?(?:,?\s+(?:suite|ste|unit|apt|room|rm|floor)\.?\s*[\w-]+)?(?:,\s*[A-Za-z .'-]+)?(?:,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?)?`,
  "i",
);

const lines = (text: string): string[] => text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
const lead = (s: string): string => s.replace(BULLET, "").trim();

function findBring(text: string): string[] {
  const out: string[] = [];
  const ls = lines(text);
  ls.forEach((line, i) => {
    const m = /\bbring\b:?\s*(.*)$/i.exec(line);
    if (!m) return;
    const inline = (m[1] ?? "").replace(/[.]$/, "").trim();
    if (inline !== "") {
      for (const part of inline.split(/,|;|\band\b/i)) out.push(part);
      return;
    }
    // "Please bring:" then one item a line, until a line that is not a short list entry.
    for (const next of ls.slice(i + 1, i + 13)) {
      if (!BULLET.test(next) && (next.length > 60 || /[.!?]$/.test(next))) break;
      out.push(lead(next));
    }
  });
  const seen = new Set<string>();
  return out
    .map((s) => s.replace(/^(?:also\s+)?(?:please\s+)?/i, "").replace(/\s+/g, " ").trim().slice(0, 120))
    .filter((s) => s.length > 1 && !seen.has(s.toLowerCase()) && (seen.add(s.toLowerCase()), true))
    .slice(0, 12);
}

const INSTRUCTION_RE = /\b(?:arrive|check.?in|do not eat|don.t eat|fast(?:ing)?|no food|forms?|wear|cancel|reschedule|call us|parking)\b/i;

function findInstructions(text: string): string[] {
  const sentences = normalizeText(text)
    .split(/(?<=[.!?])\s+|\r?\n/)
    .map((s) => lead(s.trim()))
    .filter(Boolean);
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length < 8 || s.length > 200 || /\bbring\b/i.test(s) || !INSTRUCTION_RE.test(s)) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, 8);
}

export function scanByRules(text: string, today: Date = new Date()): ScanFieldsT {
  const t = normalizeText(text);
  const ls = lines(t);
  const provider = /\bDr\.?\s+[A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?/.exec(t)?.[0].replace(/\s+/g, " ") ?? "";
  const clinic = ls.find((l) => l.length <= 80 && CLINIC_RE.test(l) && !/[.!?]$/.test(l) && !/\b(?:appointment|you have|please)\b/i.test(l) && !/^department\b/i.test(l)) ?? "";
  const department = /\bDepartment of ([A-Z][A-Za-z ]{2,40}?)(?=[.,\n]|$)/m.exec(t)?.[1] ?? "";
  const address = ADDRESS_RE.exec(t)?.[0].replace(/\s+/g, " ").trim() ?? "";
  const reason = /\bfor (?:a|an|your) ([a-z][a-z -]{3,50}?)(?=[.,\n]|$)/i.exec(t)?.[1] ?? "";
  return {
    provider: provider.slice(0, 80),
    clinic: clinic.slice(0, 80),
    date: findDate(t, today),
    time: findTime(t),
    address: address.slice(0, 200),
    department: department.trim().slice(0, 80),
    reason: reason.trim().slice(0, 200),
    instructions: findInstructions(t),
    bring: findBring(t),
  };
}
