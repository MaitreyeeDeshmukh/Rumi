// What to bring when the letter and the hospital say nothing. tests/unit/copy.test.ts lints every string here.
// A fallback, not a claim about any one hospital.
import type { CareType } from "@/features/shared/types";

export const GENERIC_BRING: Record<CareType, readonly string[]> = {
  primary: ["Photo ID", "Insurance card", "A list of your medicines", "Your questions and notes", "Your support card"],
  specialist: ["Photo ID", "Insurance card", "A list of your medicines", "Your referral letter, if you have one", "Earlier test results, if you have them", "Your questions and notes"],
  dentist: ["Photo ID", "Dental insurance card", "A list of your medicines", "Your questions and notes"],
  mental: ["Photo ID", "Insurance card", "A list of your medicines", "Notes on how you have felt", "Your support card"],
  other: ["Photo ID", "Insurance card", "A list of your medicines", "Your questions and notes", "Your support card"],
};
