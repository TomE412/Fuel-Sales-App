-- Driver Bonus Calculator — Phase A
-- New backend tables + app_settings additions. No seed data yet (that
-- comes in a follow-up script once real paper-sheet numbers are in).
--
-- HOW TO RUN: Supabase dashboard → SQL Editor → New query → paste this
-- whole file → Run.
--
-- SECURITY NOTE: this enables Row Level Security on every new table but
-- does NOT add any policies yet. That's intentional — it fails closed
-- (nobody, including the app's anon key, can read/write these tables
-- until matching policies are added) rather than accidentally exposing
-- new tables with no protection. The next step is copying the existing
-- policies from routes/trucks/depots/app_settings onto these new tables
-- so the app can actually use them.

-- 1. Physical vehicle registry (fleet numbers like "SR06").
--    Distinct from `trucks`, which is a truck-TYPE costing table for
--    route planning, not a registry of actual vehicles.
create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  fleet_no text not null unique,
  truck_key text references trucks(truck_key),
  default_trip_type text check (default_trip_type in ('collection','delivery')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table vehicles enable row level security;

-- 2. Collection bonus rate table: route x litres-range -> $ amount.
--    Range-shaped (min/max) because the litres tier is whatever the
--    driver actually reports collecting that day, not fixed by vehicle.
create table if not exists bonus_collection_rates (
  id uuid primary key default gen_random_uuid(),
  route_key text not null references routes(route_key),
  min_litres numeric not null,
  max_litres numeric,
  bonus_amount numeric not null,
  created_at timestamptz not null default now()
);
alter table bonus_collection_rates enable row level security;

-- 3. Delivery bonus band table: km-from-depot range -> $ amount.
create table if not exists bonus_delivery_bands (
  id uuid primary key default gen_random_uuid(),
  min_km numeric not null,
  max_km numeric,
  bonus_amount numeric not null,
  created_at timestamptz not null default now()
);
alter table bonus_delivery_bands enable row level security;

-- 4. app_settings additions: odometer-vs-standard-km tolerance (default
--    50km, admin-adjustable) and which depot is the delivery-bonus
--    reference point (Harare), stored as a key referencing `depots` so
--    coordinates aren't duplicated into app_settings.
alter table app_settings add column if not exists bonus_km_tolerance numeric not null default 50;
alter table app_settings add column if not exists bonus_delivery_depot_key text references depots(depot_key);
