/** Words that must never appear in visible copy: Rumi has no pricing, plans or tiers. `freeze` is fine. */
export const BANNED_WORDS: RegExp =
  /\b(pricing|price|prices|free|paid|trial|subscribe|subscription|upgrade|premium|tier|tiers|per month)\b/i;

/** Same pattern as the BANNED check in tests/e2e/quality.spec.ts: text that must never ship. */
export const BANNED_PLACEHOLDERS: RegExp = /lorem ipsum|\bTODO\b|placeholder|example\.com|undefined|\[object Object\]/i;
