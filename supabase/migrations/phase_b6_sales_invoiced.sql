-- Accounts page — "invoiced" reference checkbox
-- Lets accountants tick a sale off once they've actually invoiced the
-- customer for it. Purely a reference marker — nothing else in the app
-- reads or depends on this column, so no logic changes elsewhere.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste ->
-- Run.

alter table sales add column if not exists invoiced boolean not null default false;
