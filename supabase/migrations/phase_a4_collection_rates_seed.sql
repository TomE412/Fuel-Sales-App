-- Driver Bonus Calculator — Phase A, part 4
-- Seeds bonus_collection_rates from the "COLLECTIONS BONUS STRUCTURE -
-- 14th March 2024" sheet (typed PDF version — supersedes the earlier
-- photo transcription; two route names corrected below: "Sanrec" not
-- "Samrec", "Kamatavi" not "Kamativi"). Includes both the 17 original
-- rows AND the 7 handwritten-additions rows, now with clear running-km
-- figures. For the 7 additions, only the 40000L-tier amount is actually
-- printed on the sheet — the 30000/17500/15000 columns are genuinely
-- blank there, not illegible. Checked whether the $/km formula could
-- fill those in: it doesn't fit reliably enough to trust (e.g. Bulawayo
-- predicts ~$139 from formula vs. its real $112 40000-tier figure, a 24%
-- gap — much bigger than the rounding seen on the 17 core rows), so
-- those three tiers are left unseeded per route rather than guessed at.
-- A driver on one of these 7 routes reporting litres in an unseeded tier
-- will show up in Phase D as "no rate match" until Munya provides the
-- rest of that row.
--
-- TIER BANDING RULE (confirmed with the user): a driver's reported
-- litres get the highest tier they fully meet, not the nearest tier
-- overall. So min_litres is inclusive, max_litres is exclusive:
--   40000 tier: [40000, infinity)
--   30000 tier: [30000, 40000)
--   17500 tier: [17500, 30000)
--   15000 tier: [15000, 17500)
--   below 15000: no row -> Phase D's dashboard flags it, doesn't guess.
--
-- Routes are matched to the existing `routes` table BY NAME (not by
-- route_key, which we haven't seen) using a loose normalization (case,
-- spacing, dashes vs "to" all ignored) so this doesn't depend on knowing
-- the exact route_key slugs. A diagnostic query at the bottom lists any
-- sheet route that found no match in `routes` — if that list isn't
-- empty, those routes need to be added in the app's Logistics ->
-- Settings/Routes panel first, then this script re-run.
--
-- Safe to re-run (upserts by route_key + min_litres).
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste ->
-- Run. Run AFTER phase_a_driver_bonus_schema.sql. Read the final result
-- set (the diagnostic query) after running -- if it lists any routes,
-- paste them back so we can resolve the naming.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bonus_collection_rates_route_tier_uniq'
  ) then
    alter table bonus_collection_rates
      add constraint bonus_collection_rates_route_tier_uniq unique (route_key, min_litres);
  end if;
end $$;

create temporary table _bonus_staging (
  route_name text,
  running_km numeric,
  bonus_40000 numeric,
  bonus_30000 numeric,
  bonus_17500 numeric,
  bonus_15000 numeric
) on commit drop;

insert into _bonus_staging (route_name, running_km, bonus_40000, bonus_30000, bonus_17500, bonus_15000) values
  ('Mutare - Bikita', 936, 112, 79, 45, 39),
  ('Mutare - Bubi', 1324, 159, 109, 64, 55),
  ('Mutare - Chegutu', 887, 106, 73, 43, 37),
  ('Mutare - EHP', 280, 36, 25, 14, 12),
  ('Mutare - Forrester (Mvurwi)', 832, 100, 69, 40, 34),
  ('Mutare - Gweru', 890, 106, 73, 40, 34),
  ('Mutare - Harare', 600, 80, 63, 37, 32),
  ('Mutare - Katiyo', 324, 39, 27, 16, 13),
  ('Mutare - Makandi (Chipinge)', 418, 50, 35, 20, 17),
  ('Mutare - NSEC Murehwa', 936, 112, 78, 45, 38),
  ('Mutare - NSEC Mutoko', 980, 117, 81, 47, 40),
  ('Mutare - Sanrec', 388, 46, 32, 19, 16),
  ('Mutare - Suncrest', 138, 36, 25, 14, 12),
  ('Mutare - ZCDC', 278, 36, 25, 14, 12),
  ('Harare - Harare', 90, 36, 25, 14, 12),
  ('Mutare - Kamatavi', 1750, 180, 125, 72, 62),
  ('Harare - Chisumbanje', 761, 91, 63, 37, 31),
  ('Mutare - Ran Mine', 1024, 100, null, null, null),
  ('Masvingo', 708, 106, null, null, null),
  ('Guruve', 862, 100, null, null, null),
  ('Bulawayo', 1162, 112, null, null, null),
  ('Siyabuya', 1725, 180, null, null, null),
  ('Muriel - Msasa', 314, 39, null, null, null),
  ('Msasa - BYO', 894, 112, null, null, null);

-- normalize: lowercase, "X to Y" -> "X Y", strip everything but letters/digits
-- (PostgreSQL has no CREATE TEMPORARY FUNCTION; this creates a normal
-- function and drops it again below so nothing is left behind)
create or replace function pg_temp._norm(text) returns text as $$
  select regexp_replace(lower(regexp_replace($1, '\s+to\s+', ' ', 'g')), '[^a-z0-9]+', '', 'g')
$$ language sql immutable;

insert into bonus_collection_rates (route_key, min_litres, max_litres, bonus_amount)
select r.route_key, tier.min_litres, tier.max_litres, tier.bonus_amount
from _bonus_staging s
join routes r on _norm(r.route_name) = _norm(s.route_name)
cross join lateral (values
  (40000::numeric, null::numeric, s.bonus_40000),
  (30000::numeric, 40000::numeric, s.bonus_30000),
  (17500::numeric, 30000::numeric, s.bonus_17500),
  (15000::numeric, 17500::numeric, s.bonus_15000)
) as tier(min_litres, max_litres, bonus_amount)
where tier.bonus_amount is not null
on conflict (route_key, min_litres) do update set
  max_litres = excluded.max_litres,
  bonus_amount = excluded.bonus_amount;

drop function _norm(text);

-- Diagnostic: sheet routes with no match in `routes` — read this after running.
select s.route_name as "sheet route with no match in routes table"
from _bonus_staging s
where not exists (
  select 1 from routes r
  where regexp_replace(lower(regexp_replace(r.route_name, '\s+to\s+', ' ', 'g')), '[^a-z0-9]+', '', 'g')
      = regexp_replace(lower(regexp_replace(s.route_name, '\s+to\s+', ' ', 'g')), '[^a-z0-9]+', '', 'g')
);
