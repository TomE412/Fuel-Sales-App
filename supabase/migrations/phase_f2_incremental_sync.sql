-- phase_f2_incremental_sync.sql
--
-- Cuts Supabase egress by letting screens ask "what changed?" instead of
-- re-downloading everything every 30 seconds.
--
-- The TV dashboard was pulling 90 days of sales (193 kB) AND every delivery
-- assignment ever made, twice a minute, around the clock. That is roughly
-- 16 GB a month from one wall display against a 5 GB allowance, which is
-- what put the account over its quota.
--
-- sales.updated_at already exists (phase_f1 / Box 1). This does the same for
-- delivery_assignment, which is the other half of the traffic: one row per
-- assigned load, all ten columns, no date filter at all.
--
-- Run this BEFORE pushing the new dashboard and admin files. They filter on
-- updated_at; without the column every poll fails and the board falls back
-- to its cached copy.

-- ============================================================
-- PART 1 — a last-touched stamp on every assignment
-- ============================================================

alter table delivery_assignment
  add column if not exists updated_at timestamptz not null default now();

comment on column delivery_assignment.updated_at is
  'Maintained by a trigger. Screens poll on this so they can fetch only '
  'what changed instead of the whole table.';

-- One function, reused. sales already has its own from phase_f1; this is
-- deliberately a separate name so neither can be dropped out from under
-- the other.
create or replace function public.touch_assignment_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists assignment_set_updated_at on delivery_assignment;
create trigger assignment_set_updated_at
  before update on delivery_assignment
  for each row execute function public.touch_assignment_updated_at();

create index if not exists delivery_assignment_updated_at_idx
  on delivery_assignment (updated_at desc);

-- ============================================================
-- PART 2 — backfill
-- ============================================================
-- Without this every existing row reads "now", so the first incremental
-- poll after deploying would correctly return nothing and the board would
-- look right by luck rather than by design. Give them an honest history:
-- the latest real timestamp the row carries.

update delivery_assignment
set updated_at = coalesce(en_route_at, seen_by_rep_at, assigned_at)
where updated_at >= now() - interval '5 minutes'
  and coalesce(en_route_at, seen_by_rep_at, assigned_at) is not null;

-- ============================================================
-- PART 3 — check
-- ============================================================
-- Expect column 1, trigger 1, index 1, and a SPREAD of dates. If oldest and
-- newest are both today the backfill did not take, which would mean the
-- first poll silently returns nothing.

select 'updated_at column' as check, count(*)::text as result
  from information_schema.columns
  where table_name = 'delivery_assignment' and column_name = 'updated_at'
union all
select 'trigger', count(*)::text
  from pg_trigger where tgname = 'assignment_set_updated_at'
union all
select 'index', count(*)::text
  from pg_indexes where indexname = 'delivery_assignment_updated_at_idx'
union all
select 'assignment rows', count(*)::text from delivery_assignment
union all
select 'oldest updated_at', coalesce(min(updated_at)::date::text, '(none)') from delivery_assignment
union all
select 'newest updated_at', coalesce(max(updated_at)::date::text, '(none)') from delivery_assignment;
