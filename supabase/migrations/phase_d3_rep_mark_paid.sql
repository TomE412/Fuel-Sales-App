-- phase_d3_rep_mark_paid.sql
--
-- Lets a chosen sales rep mark their own sales as paid from their phone.
-- Asked for by Carrie Watson, who wants to keep an eye on her own accounts.
--
-- Switched on PER REP, not for everybody: `profiles.can_mark_paid`. Turning
-- it on for someone else later is one update, no code change and no new
-- version of the app.
--
--     update profiles set can_mark_paid = true  where full_name = 'Name Here';
--     update profiles set can_mark_paid = false where full_name = 'Name Here';
--
-- An honest limit, worth knowing before you rely on it: this is a switch on
-- what the app OFFERS, not a lock on what the database allows. Reps already
-- update their own sales (that is how "mark as delivered" works), so the
-- permission to set `paid` was always there - no button was ever drawn for
-- it. If you need it to be a real restriction rather than a tidier screen,
-- say so and it becomes a column-level grant, which is a bigger change.
--
-- paid_at / paid_by are recorded so accounts can tell a rep's tick apart
-- from their own. Same shape as cost_check_at / cost_check_by in phase_c4.
--
-- Safe to run twice. Nothing is deleted.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste the
-- whole thing -> Run. The table at the end is the result.

alter table sales    add column if not exists paid_at timestamptz;
alter table sales    add column if not exists paid_by text;
alter table profiles add column if not exists can_mark_paid boolean not null default false;

-- Carrie Watson does not appear under that name. Her login is "Tom Eager CW"
-- (CW = Carrie Watson), and every sale she has ever logged carries
-- rep_name = "Tom Eager CW". The flag therefore goes on that profile - see
-- the note at the end of this file about her name.
update profiles set can_mark_paid = true
where full_name = 'Tom Eager CW';

create index if not exists sales_paid_at_idx
  on sales (paid_at)
  where paid_at is not null;

-- =====================================================================
-- WHAT YOU SHOULD SEE
-- =====================================================================
-- Every person on the system, and whether they can tick a sale as paid.
-- Exactly one row should say YES unless you asked for more.

select full_name,
       role,
       case when can_mark_paid then 'YES - can mark sales paid' else 'no' end as mark_paid
from profiles
order by can_mark_paid desc, full_name;

-- =====================================================================
-- A SEPARATE PROBLEM, DELIBERATELY NOT FIXED HERE
-- =====================================================================
-- "Tom Eager CW" is Carrie Watson, and paid_by will record that login name
-- rather than her own. Renaming the profile is NOT safe on its own: every
-- sale she has logged carries rep_name = "Tom Eager CW", so a rename would
-- split her history in two - new sales under one name, past sales under
-- another, and the leaderboard and commission reports would show both.
-- Doing it properly means renaming the profile AND backfilling rep_name on
-- her existing sales in the same transaction. Ask for it as its own change.
