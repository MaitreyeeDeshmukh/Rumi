import { scanByRules } from "@/features/appointmentScan/rules";
import type { AppointmentScanReplyT, AppointmentScanRequestT } from "@/features/shared/schemas";

/** MOCK_AI answer: the rules reader, so a demo shows real fields from the pasted text. */
export const appointmentScanMock = (r: AppointmentScanRequestT): AppointmentScanReplyT => ({ fields: scanByRules(r.text) });
