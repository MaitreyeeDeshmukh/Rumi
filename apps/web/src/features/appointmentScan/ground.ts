/**
 * The accuracy check for a scan. Every value a model read out of a letter must be findable in the letter's own words,
 * or it is blanked. The person then fills the gap on the confirm screen. This cannot prove a value is right, so the
 * confirm screen is still the real guard; it stops a model from adding a doctor, a day or an item the letter never had.
 */
import type { ScanFieldsT } from "@/features/shared/schemas";
import { STOPWORDS, toSet } from "@/features/shared/lists";
import { normalizeText } from "@/lib/text/tokens";

const STOP = toSet(STOPWORDS);
const TITLES = new Set(["dr", "doctor", "md", "do", "mr", "ms", "mrs", "np", "pa"]);
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const tokens = (s: string): string[] => normalizeText(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const has = (set: Set<string>, w: string): boolean => set.has(w) || set.has(w.replace(/s$/, "")) || set.has(`${w}s`);

/** Names and places: every word (except a title) must be in the source. */
function strictlyIn(value: string, src: Set<string>): boolean {
  const need = tokens(value).filter((w) => !TITLES.has(w));
  return need.length > 0 && need.every((w) => has(src, w));
}

/** Sentences and phrases: at least two thirds of the content words must be in the source, and there must be one. */
function looselyIn(value: string, src: Set<string>): boolean {
  const need = tokens(value).filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOP.has(w));
  return need.length > 0 && need.filter((w) => has(src, w)).length * 3 >= need.length * 2;
}

/** An address may spell "St." as "Street", so most words must match, but every number must. */
function addressIn(value: string, src: Set<string>): boolean {
  return looselyIn(value, src) && tokens(value).filter((w) => /\d/.test(w)).every((w) => src.has(w));
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** True for a real calendar day written as YYYY-MM-DD. */
export function validIsoDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return y >= 2000 && t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Does the text write this month and day in any common way? The year is not checked: letters often leave it out. */
export function dateInText(iso: string, text: string): boolean {
  if (!validIsoDate(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const src = normalizeText(text).toLowerCase();
  const full = MONTHS[m - 1]!;
  const names = `(?:${full}|${full.slice(0, 3)}|sept)`;
  const day = `0?${d}(?:st|nd|rd|th)?`;
  const patterns = [
    String.raw`\b${names}\.?\s+${day}\b`,
    String.raw`\b${day}\s+(?:of\s+)?${names}\b`,
    String.raw`\b0?${m}[/.-]0?${d}(?:[/.-]\d{2,4})?\b`,
    String.raw`\b0?${d}[/.-]0?${m}(?:[/.-]\d{2,4})?\b`,
    String.raw`\b${y}-${pad(m)}-${pad(d)}\b`,
  ];
  return patterns.some((p) => new RegExp(p).test(src));
}

/** Does the text write this HH:MM in any common way (9:30 am, 09:30, 9.30, 14:00, 2 pm)? */
export function timeInText(time: string, text: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return false;
  const [h, min] = [Number(m[1]), Number(m[2])];
  if (h > 23 || min > 59) return false;
  const src = normalizeText(text).toLowerCase();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = pad(min);
  const ampm = String.raw`\s*[ap]\.?\s?m\b`;
  const patterns = [String.raw`\b0?${h}:${mm}\b`, String.raw`\b0?${h12}[:.]${mm}${ampm}`, String.raw`\b0?${h}[.]${mm}\b`, String.raw`\b${pad(h)}${mm}\b`];
  if (min === 0) patterns.push(String.raw`\b0?${h12}${ampm}`);
  return patterns.some((p) => new RegExp(p).test(src));
}

const clean = (s: string, max: number): string => s.replace(/\s+/g, " ").trim().slice(0, max);

function keepGrounded(list: readonly string[], src: Set<string>, max: number, count: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const t = clean(raw, max);
    const key = t.toLowerCase();
    if (t === "" || seen.has(key) || !looselyIn(t, src)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= count) break;
  }
  return out;
}

/** The fields with every value the source text does not back removed (empty string or left out of a list). */
export function groundFields(f: ScanFieldsT, source: string): ScanFieldsT {
  const src = new Set(tokens(source));
  const text = (v: string, max: number): string => {
    const t = clean(v, max);
    return t !== "" && strictlyIn(t, src) ? t : "";
  };
  const date = validIsoDate(f.date) && dateInText(f.date, source) ? f.date : "";
  const time = timeInText(f.time, source) ? f.time : "";
  return {
    provider: text(f.provider, 80),
    clinic: text(f.clinic, 80),
    date,
    time,
    address: ((a) => (a !== "" && addressIn(a, src) ? a : ""))(clean(f.address, 200)),
    department: text(f.department, 80),
    reason: ((r) => (r !== "" && looselyIn(r, src) ? r : ""))(clean(f.reason, 200)),
    instructions: keepGrounded(f.instructions, src, 200, 8),
    bring: keepGrounded(f.bring, src, 120, 12),
  };
}

/** How many fields hold something. Zero means the scan found nothing. */
export function filledCount(f: ScanFieldsT): number {
  const singles = [f.provider, f.clinic, f.date, f.time, f.address, f.department, f.reason].filter((v) => v !== "").length;
  return singles + (f.instructions.length > 0 ? 1 : 0) + (f.bring.length > 0 ? 1 : 0);
}
