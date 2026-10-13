-- phase_d4_undo_delivered.sql
--
-- A delivery can now be put back to "not delivered" - by the rep who ticked
-- it, and from the Overview board.
--
-- WHY THIS MATTERS MORE THAN AN ORDINARY EDIT: accounts invoice off the
-- delivered tick. A wrong tick becomes a wrong invoice, and until now there
-- was no way to take it back. So the reversal is recorded rather than
-- silently applied - accounts need to be able to see that a sale they may
-- already have invoiced went backwards, and who did it.
--
-- Same shape as cost_check_at / cost_check_by (phase_c4) and paid_at /
-- paid_by (phase_d3). Only the most recent reversal is kept, which is what
-- the question "why is this one back on the board?" actually needs.
--
-- Nothing reads these columns to make a decision. They are a trail.
--
-- Safe to run twice. Nothing is deleted.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste the
-- whole thing -> Run. The table at the end is the result.

alter table sales add column if not exists undelivered_at timestamptz;
alter table sales add column if not exists undelivered_by text;

create index if not exists sales_undelivered_at_idx
  on sales (undelivered_at)
  where undelivered_at is not null;

-- =====================================================================
-- WHAT YOU SHOULD SEE
-- =====================================================================
-- Empty today, because nothing has been reversed yet. From now on every
-- reversal lands here, and the last column is the one to watch: a sale that
-- was invoiced and then put back is the case that needs a phone call to
-- accounts.

select s.customer,
       s.litres,
       s.rep_name,
       to_char(s.undelivered_at, 'DD Mon YYYY HH24:MI') as put_back_at,
       s.undelivered_by                                 as put_back_by,
       case when s.invoiced then 'INVOICED - tell accounts' else 'not invoiced' end as invoice_state
from sales s
where s.undelivered_at is not null
order by s.undelivered_at desc
limit 50;
