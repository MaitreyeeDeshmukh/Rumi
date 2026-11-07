/**
 * From the fields the person checked to a saved appointment. Pure. Only the words read from the document are kept
 * (an excerpt), never a picture. The person confirmed every field, so the document is saved as confirmed.
 */
import type { ScanFieldsT } from "@/features/shared/schemas";
import type { Appointment, ApptDocument, CareType, ChecklistItem } from "@/features/shared/types";
import { buildChecklist } from "@/features/checklist/buildChecklist";

const EXCERPT_MAX = 4000;

/** A first guess at the kind of care from the words the letter used. The person can change it. */
export function guessCare(f: Pick<ScanFieldsT, "department" | "clinic" | "reason" | "provider">): CareType {
  const t = `${f.department} ${f.clinic} ${f.reason} ${f.provider}`.toLowerCase();
  if (/\b(?:dental|dentist|orthodont|oral)\b/.test(t)) return "dentist";
  if (/\b(?:psych|counsel|therap|mental|behavio)/.test(t)) return "mental";
  if (/\b(?:primary|family|general|internal medicine|pediatric)\b/.test(t)) return "primary";
  if (t.trim() !== "") return /\b(?:cardio|neuro|derma|ortho|oncolog|gastro|endocrin|urolog|rheumat|ophthalm|ent|surgery|specialist|clinic|center)/.test(t) ? "specialist" : "other";
  return "other";
}

/** Lines typed in a text box to a clean list: no empty lines, no repeats, each cut to `max`. */
export function linesToList(text: string, count: number, max: number): string[] {
  const seen = new Set<string>();
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").replace(/\s+/g, " ").trim().slice(0, max))
    .filter((l) => l !== "" && !seen.has(l.toLowerCase()) && (seen.add(l.toLowerCase()), true))
    .slice(0, count);
}

export interface ScannedInput {
  care: CareType;
  provider: string;
  clinic: string;
  date: string;
  time: string;
  address: string;
  department: string;
  reason: string;
  instructions: string;
  bring: string;
  /** The words read from the document. */
  text: string;
  docKind: ApptDocument["kind"];
  docName: string;
}

export function buildScannedAppointment(input: ScannedInput, id: string, docId: string, now: Date): Appointment {
  const provider = input.provider.trim().slice(0, 80);
  const clinic = input.clinic.trim().slice(0, 80);
  const address = input.address.trim().slice(0, 200);
  const department = input.department.trim().slice(0, 80);
  const instructions = linesToList(input.instructions, 12, 300);
  const doc: ApptDocument = {
    id: docId,
    kind: input.docKind,
    name: input.docName.trim().slice(0, 120) || "Document",
    createdAt: now.toISOString(),
    excerpt: input.text.trim().slice(0, EXCERPT_MAX),
    confirmed: true,
  };
  const a: Appointment = {
    id,
    care: input.care,
    providerName: provider || clinic,
    clinic: provider ? clinic : "",
    date: input.date,
    time: input.time,
    reason: input.reason.trim().slice(0, 200),
    status: "to_confirm",
    createdAt: now.toISOString(),
    questions: [],
    bring: [],
    symptoms: [],
    source: "scanned",
    ...(address ? { address } : {}),
    ...(department ? { department } : {}),
    ...(instructions.length > 0 ? { instructions } : {}),
    documents: [doc],
  };
  // What the letter lists to bring is the top of the checklist. With none listed, the common list for this care is added.
  const bring = linesToList(input.bring, 12, 120);
  const letter: ChecklistItem[] = bring.map((text, n) => ({ id: `l-${n + 1}`, text, source: "letter", done: false }));
  return { ...a, checklist: buildChecklist(letter.length > 0 ? { ...a, checklist: letter } : a) };
}
