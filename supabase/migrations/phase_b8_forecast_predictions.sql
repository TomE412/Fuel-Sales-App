-- Weekly Forecast predictions
-- Saves the customer-by-customer expected list at Monday forecast time so
-- an end-of-week review can compare who was expected to buy against who
-- actually placed a sale in the same Monday-to-Friday window.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- SECURITY NOTE: RLS is enabled, and this migration adds the app policy that
-- lets the browser-based sales dashboard read/write the expected-customer
-- forecast rows for the Monday-to-Friday review process.

create table if not exists weekly_forecast_predictions (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  customer text not null,
  expected_date date,
  expected_litres numeric not null default 0,
  fuel_type text,
  route text,
  payment_term text,
  amount_estimate numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (week_start, customer)
);

alter table weekly_forecast_predictions enable row level security;

create policy "forecast predictions are readable and writable by the app"
on weekly_forecast_predictions
for all
using (true)
with check (true);
