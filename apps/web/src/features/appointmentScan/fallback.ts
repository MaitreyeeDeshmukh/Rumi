import { scanByRules } from "@/features/appointmentScan/rules";
import type { AppointmentScanReplyT, AppointmentScanRequestT } from "@/features/shared/schemas";

/** The AI-down answer: the same rules reader. The confirm screen shows the person what it found. */
export const appointmentScanFallback = (r: AppointmentScanRequestT): AppointmentScanReplyT => ({ fields: scanByRules(r.text) });
