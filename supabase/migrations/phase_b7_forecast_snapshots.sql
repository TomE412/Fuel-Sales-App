-- Weekly Forecast — forecast vs. actual history
-- The Weekly Forecast tab (accounts/index.html and admin/index.html's
-- Accounts tab) has always computed live from today's data — nothing
-- about a past week's prediction was ever saved, so there was no way to
-- see how the ripeness-driven forecast tracked reality over time. This
-- table starts recording one snapshot per week, the first time that week
-- is viewed, so a forecast-vs-actual trend chart can build up going
-- forward. Deliberately NOT retroactive — there is no way to know what
-- would have been predicted for a week that already passed.
--
-- Two numbers per week, not one blended total: scheduled_litres (already-
-- booked litres for that week at snapshot time) and predicted_litres (the
-- ripeness-driven estimate). Kept separate so a future look can tell "a
-- booked order fell through" apart from "we mispredicted a new order" —
-- the latter is what actually diagnoses whether the ripeness thresholds
-- need tuning.
--
-- Write rule (enforced in app code, not here): first view of a given
-- week inserts the row; later views of the same week never overwrite it.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste ->
-- Run.
--
-- SECURITY NOTE: RLS is enabled, and this migration adds the browser-app
-- policies needed so the internal sales dashboard can read/write the
-- weekly forecast snapshot rows without blocking the forecast review flow.

create table if not exists weekly_forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  scheduled_litres numeric not null default 0,
  predicted_litres numeric not null default 0,
  potential_count integer not null default 0,
  created_at timestamptz not null default now()
);
alter table weekly_forecast_snapshots enable row level security;

create policy "forecast snapshots are readable and writable by the app"
on weekly_forecast_snapshots
for all
using (true)
with check (true);
