/**
 * Every table with an `owner_id` column that holds a person's rows (supabase v1 migration). Delete-account counts
 * these through the admin client after the user is removed; each must be 0. Keep in step with the migrations: a
 * new owner table that is missing here is a table whose erasure is never verified.
 */
export const OWNER_TABLES = [
  "core_profiles",
  "core_settings",
  "core_consents",
  "plan_visit_plans",
  "plan_items",
  "plan_support_cards",
  "plan_support_items",
  "plan_support_top_questions",
  "practice_sessions",
  "practice_turns",
  "practice_item_outcomes",
  "recap_recaps",
  "recap_transcript_lines",
  "recap_items",
  "recap_unconfirmed_items",
  "recap_plan_status",
  "persona_facts",
  "persona_removed",
] as const;
