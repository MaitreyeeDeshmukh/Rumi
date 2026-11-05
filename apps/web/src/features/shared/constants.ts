/**
 * Shared constants for the Rumi AI contract. Frozen in Phase 0 (see 07-p0-roast-resolutions.md).
 * Change only through the orchestrator, and only by adding.
 */
export const FOCUS_VALUES = ['problem', 'questions', 'needs', 'next_steps', 'whole'] as const;
export const SAY_SCENARIOS = ['book', 'late', 'repeat', 'written', 'next'] as const;
export const PLAN_ITEM_KINDS = ['concern', 'question', 'accommodation'] as const;
export const SPEAKERS = ['A', 'B', 'C', 'D'] as const;
export const HELP_LEVELS = [0, 1, 2, 3] as const;

/** Preset support statements are synced by id only; their text lives in one table (features/support/presets.ts). */
export const SUPPORT_PRESET_IDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const;
export const PACING_KEYS = ['one_question', 'extra_time'] as const;
export const FACT_KINDS = ['support_pref', 'pacing', 'help_level'] as const;

/** Ids from the browser are untrusted: letters, digits, underscore, hyphen only. */
export const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
/** The helper's name is placed in the system prompt, so it is an allowlist, not free text. */
export const COMPANION_RE = /^[A-Za-z][A-Za-z '-]{0,29}$/;
export const FACT_KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;

export const LIMITS = {
  rawTextMax: 2000,
  turnsMax: 20,
  turnTextMax: 600,
  linesMax: 60,
  lineTextMax: 400,
  planItemsMax: 12,
  itemTextMax: 200,
  concernMax: 300,
  factsMax: 20,
  bodyBytesMax: 64_000,
} as const;
