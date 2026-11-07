/**
 * Appointment scan: the person's own letter or email text becomes fields they then check and confirm.
 * The harness does not remove addresses, phones or dates here (skipRedaction): they are what we read. In place of that,
 * every value must be found in the letter's own words (ground.ts) or it is blanked, and the person confirms every field.
 */
import { appointmentScanFallback } from "@/features/appointmentScan/fallback";
import { filledCount, groundFields } from "@/features/appointmentScan/ground";
import { appointmentScanMock } from "@/features/appointmentScan/mock";
import { isoDate } from "@/features/appointments/appointments";
import {
  AppointmentScanModelOut,
  AppointmentScanReply,
  AppointmentScanRequest,
  type AppointmentScanModelOutT,
  type AppointmentScanReplyT,
  type AppointmentScanRequestT,
} from "@/features/shared/schemas";
import type { TaskSpec } from "@/features/shared/task";
import { RUMI_PERSONA } from "../../../prompts/persona";
import { APPOINTMENT_SCAN_VERSION, appointmentScanTask } from "../../../prompts/appointmentScan";

export const appointmentScanSpec: TaskSpec<AppointmentScanRequestT, AppointmentScanModelOutT, AppointmentScanReplyT> = {
  name: "appointmentScan",
  promptVersion: APPOINTMENT_SCAN_VERSION,
  tier: "quality",
  request: AppointmentScanRequest,
  modelOut: AppointmentScanModelOut,
  reply: AppointmentScanReply,
  // The pasted text is the person's own, so it gets the same crisis check as anything they type.
  crisisFields: (r) => ({ text: r.text }),
  buildLedger: () => ({ items: [], thin: false }),
  build: (ctx) => ({ system: RUMI_PERSONA, user: `${appointmentScanTask(isoDate(new Date()))}\nLETTER: ${ctx.fence("letter", ctx.r.text)}` }),
  // A scan with nothing left after the source check is a failed attempt: the harness retries once, then the rules reader answers.
  validate: (r, o) => (filledCount(groundFields(o, r.text)) === 0 ? ["empty"] : []),
  finalize: (r, o) => ({ fields: groundFields(o, r.text) }),
  fallback: appointmentScanFallback,
  // The letter says what to do ("do not eat"), and the model only copies it. The source check is the guard.
  adviceGuard: false,
  useMemory: false,
  temperature: 0,
  maxOutputTokens: 1500,
  mock: appointmentScanMock,
  skipRedaction: true,
};
