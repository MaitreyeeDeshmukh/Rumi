-- Rumi production migration D of E: TRIGGERS. One transaction.
-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE on the table (blocks writers for an instant); it gives up after 3 s
-- instead of queueing in front of them.
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- A direct delete of a persona fact leaves a tombstone (private.persona_tombstone, file A). Depth 0 only: deletes made
-- by foreign-key cascades (account deletion) run at depth 1 and must not write rows for a user who is going away.
drop trigger if exists persona_facts_tombstone on public.persona_facts;
create trigger persona_facts_tombstone after delete on public.persona_facts
  for each row when (pg_trigger_depth() = 0) execute function private.persona_tombstone();
