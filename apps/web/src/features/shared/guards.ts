/**
 * Guard codes: the only thing guards may return or log. Never user text.
 * One table decides severity, so "hard" and "soft" cannot drift between files.
 */
export type GuardCode =
  | 'schema'
  | 'advice_dose'
  | 'advice_diagnosis'
  | 'advice_treatment'
  | 'claims_human'
  | 'clinician_finding'
  | 'invented_specific'
  | 'invalid_blank'
  | 'unknown_label'
  | 'main_concern_not_from_user'
  | 'no_user_items'
  | 'specific_suggestion'
  | 'level1_statement'
  | 'empty'
  | 'lint_too_long'
  | 'lint_idiom'
  | 'lint_double_command'
  | 'multi_question'
  | 'level1_no_question';

/** Record<GuardCode, ...> makes the compiler fail if a code is added without a severity. */
export const SEVERITY: Record<GuardCode, 'hard' | 'soft'> = {
  schema: 'hard',
  advice_dose: 'hard',
  advice_diagnosis: 'hard',
  advice_treatment: 'hard',
  claims_human: 'hard',
  clinician_finding: 'hard',
  invented_specific: 'hard',
  invalid_blank: 'hard',
  unknown_label: 'hard',
  main_concern_not_from_user: 'hard',
  no_user_items: 'hard',
  specific_suggestion: 'hard',
  level1_statement: 'hard',
  empty: 'hard',
  lint_too_long: 'soft',
  lint_idiom: 'soft',
  lint_double_command: 'soft',
  multi_question: 'soft',
  level1_no_question: 'soft',
};

export const ALL_GUARD_CODES = Object.keys(SEVERITY) as GuardCode[];

export const isHard = (code: GuardCode): boolean => SEVERITY[code] === 'hard';

/** Telemetry entries must look like "hard:advice_dose". Used by a test that scans every logged event. */
export const GUARD_LOG_RE = /^(hard|soft):[a-z0-9_]+$/;
export const logLabel = (code: GuardCode): string => `${SEVERITY[code]}:${code}`;
