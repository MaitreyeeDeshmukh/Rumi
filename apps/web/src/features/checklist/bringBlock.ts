import { CHECK } from '@/content/appointmentScan';
import { dayShort, splitAppointments } from '@/features/appointments/appointments';
import { checklistText } from '@/features/checklist/buildChecklist';
import { fill } from '@/lib/fill';
import type { RumiState } from '@/features/shared/types';

/** "What to bring to Dr. Lee" and the list, for the next upcoming visit that has one. '' when there is none. */
export function bringBlock(state: RumiState, now: Date): string {
  const next = splitAppointments(state.appointments ?? [], now).upcoming.find((a) => (a.checklist ?? []).length > 0);
  if (!next) return '';
  return `${fill(CHECK.bringTitle, { who: next.providerName })}, ${dayShort(next.date)}\n${checklistText(next.checklist ?? [])}`;
}
