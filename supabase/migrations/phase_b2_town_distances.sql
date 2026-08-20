-- Commission report — real depot-to-town distances (Ruwa list)
-- Follows [[sales-distance-accuracy]]: the Commission report currently
-- computes sale.distance_km as a straight-line (haversine) x road_factor
-- estimate, which the user flagged as not accurate enough for commission
-- payouts. This script loads the user's real driving-distance list
-- ("Zimbabwe_Distances_from_Ruwa.csv", 88 towns) as a reference table,
-- then resolves each existing place_coords row against it by name so the
-- app can use the real number wherever one exists and only fall back to
-- the straight-line estimate for places not covered by the list.
--
-- Two new pieces of state:
--   1. town_distances — durable reference table, one row per town, this
--      is what you re-import into if you ever bring a corrected/extended
--      list. Safe to re-run this whole script any time the CSV changes.
--   2. place_coords.depot_distance_km — resolved per-place real distance,
--      set by matching place_coords.place (falling back to .parent) to
--      town_distances.town with loose normalization (case/spacing/
--      punctuation ignored), same approach as the collection-rate route
--      matching in phase_a4. NULL means "no match yet" — admin/index.html
--      falls back to the haversine estimate for those.
--
-- NOTE: re-running this OVERWRITES depot_distance_km for every place_coords
-- row that matches a town_distances row. If you ever hand-correct a single
-- place's distance directly in Supabase (e.g. a specific farm that's
-- further off the main road than its nearest town), re-running this script
-- will replace that hand correction with the town-level number again.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste this
-- whole file -> Run. Then read the final result set (the diagnostic query)
-- to see, place by place: matched town, the real km from your list, and
-- the estimate the app was using before — and which places found no match
-- at all (still on the estimate; add rows/aliases below if you have real
-- numbers for those too).
--
-- SECURITY NOTE: town_distances is created with RLS enabled and no
-- policies yet (fails closed). Copy the same select policy used on
-- place_coords/routes onto town_distances in the Supabase dashboard so
-- the app can actually read it.

create table if not exists town_distances (
  id uuid primary key default gen_random_uuid(),
  town text not null unique,
  province text,
  distance_km numeric not null,
  created_at timestamptz not null default now()
);
alter table town_distances enable row level security;

alter table place_coords add column if not exists depot_distance_km numeric;

create temporary table _town_staging (
  town text,
  province text,
  distance_km numeric
) on commit drop;

insert into _town_staging (town, province, distance_km) values
  ('Ruwa', 'Mashonaland East', 0),
  ('Melfort', 'Mashonaland East', 12),
  ('Epworth', 'Harare', 18),
  ('Bromley', 'Mashonaland East', 18),
  ('Harare', 'Harare', 22),
  ('Goromonzi', 'Mashonaland East', 25),
  ('Chitungwiza', 'Harare', 30),
  ('Domboshava', 'Mashonaland East', 40),
  ('Juru', 'Mashonaland East', 45),
  ('Marondera', 'Mashonaland East', 52),
  ('Mazowe', 'Mashonaland Central', 60),
  ('Norton', 'Mashonaland West', 62),
  ('Beatrice', 'Mashonaland East', 65),
  ('Murewa', 'Mashonaland East', 70),
  ('Glendale', 'Mashonaland Central', 85),
  ('Concession', 'Mashonaland Central', 90),
  ('Macheke', 'Mashonaland East', 95),
  ('Selous', 'Mashonaland West', 95),
  ('Featherstone', 'Mashonaland East', 100),
  ('Bindura', 'Mashonaland Central', 110),
  ('Banket', 'Mashonaland West', 110),
  ('Wedza', 'Mashonaland East', 115),
  ('Hwedza', 'Mashonaland East', 115),
  ('Shamva', 'Mashonaland Central', 115),
  ('Headlands', 'Manicaland', 120),
  ('Chegutu', 'Mashonaland West', 125),
  ('Mvurwi', 'Mashonaland Central', 125),
  ('Uzumba', 'Mashonaland East', 130),
  ('Mutoko', 'Mashonaland East', 140),
  ('Chinhoyi', 'Mashonaland West', 140),
  ('Rusape', 'Manicaland', 148),
  ('Nyazura', 'Manicaland', 165),
  ('Chivhu', 'Mashonaland East', 165),
  ('Kadoma', 'Mashonaland West', 165),
  ('Guruve', 'Mashonaland Central', 180),
  ('Mhangura', 'Mashonaland West', 180),
  ('Mount Darwin', 'Mashonaland Central', 185),
  ('Centenary', 'Mashonaland Central', 185),
  ('Buhera', 'Manicaland', 200),
  ('Mudzi', 'Mashonaland East', 210),
  ('Odzi', 'Manicaland', 215),
  ('Mvuma', 'Midlands', 215),
  ('Karoi', 'Mashonaland West', 225),
  ('Kwekwe', 'Midlands', 235),
  ('Mutare', 'Manicaland', 245),
  ('Redcliff', 'Midlands', 245),
  ('Magunje', 'Mashonaland West', 245),
  ('Nyamapanda', 'Mashonaland East', 250),
  ('Chatsworth', 'Masvingo', 250),
  ('Nyanga', 'Manicaland', 255),
  ('Sanyati', 'Mashonaland West', 255),
  ('Penhalonga', 'Manicaland', 265),
  ('Gutu', 'Masvingo', 275),
  ('Mutasa', 'Manicaland', 280),
  ('Birchenough Bridge', 'Manicaland', 290),
  ('Gweru', 'Midlands', 295),
  ('Masvingo', 'Masvingo', 315),
  ('Shurugwi', 'Midlands', 320),
  ('Makuti', 'Mashonaland West', 320),
  ('Chimanimani', 'Manicaland', 340),
  ('Chipinge', 'Manicaland', 345),
  ('Bikita', 'Masvingo', 360),
  ('Zvishavane', 'Midlands', 370),
  ('Gokwe', 'Midlands', 370),
  ('Chirundu', 'Mashonaland West', 370),
  ('Ngundu', 'Masvingo', 370),
  ('Zaka', 'Masvingo', 370),
  ('Kariba', 'Mashonaland West', 385),
  ('Triangle', 'Masvingo', 415),
  ('Mberengwa', 'Midlands', 420),
  ('Chiredzi', 'Masvingo', 430),
  ('Mwenezi', 'Masvingo', 430),
  ('Filabusi', 'Matabeleland South', 440),
  ('Bulawayo', 'Bulawayo', 460),
  ('Rutenga', 'Masvingo', 475),
  ('Esigodini', 'Matabeleland South', 495),
  ('West Nicholson', 'Matabeleland South', 545),
  ('Plumtree', 'Matabeleland South', 560),
  ('Nkayi', 'Matabeleland North', 560),
  ('Tsholotsho', 'Matabeleland North', 560),
  ('Colleen Bawn', 'Matabeleland South', 575),
  ('Gwanda', 'Matabeleland South', 590),
  ('Beitbridge', 'Matabeleland South', 600),
  ('Lupane', 'Matabeleland North', 630),
  ('Gwayi', 'Matabeleland North', 690),
  ('Dete', 'Matabeleland North', 720),
  ('Binga', 'Matabeleland North', 760),
  ('Hwange', 'Matabeleland North', 800),
  ('Victoria Falls', 'Matabeleland North', 900);
-- ('Harare' and 'Wedza'/'Hwedza' above are split out of the source CSV's
-- "Harare (CBD)" / "Wedza (Hwedza)" rows so both common spellings match.)

create or replace function pg_temp._norm_town(text) returns text as $$
  select regexp_replace(lower($1), '[^a-z0-9]+', '', 'g')
$$ language sql immutable;

insert into town_distances (town, province, distance_km)
select town, province, distance_km from _town_staging
on conflict (town) do update set
  province = excluded.province,
  distance_km = excluded.distance_km;

update place_coords p
set depot_distance_km = m.distance_km
from (
  select p2.place as place_key, t.distance_km,
         row_number() over (
           partition by p2.place
           order by case when pg_temp._norm_town(t.town) = pg_temp._norm_town(p2.place) then 0 else 1 end
         ) as rn
  from place_coords p2
  join town_distances t
    on pg_temp._norm_town(t.town) = pg_temp._norm_town(p2.place)
    or (p2.parent is not null and pg_temp._norm_town(t.town) = pg_temp._norm_town(p2.parent))
) m
where m.place_key = p.place and m.rn = 1;

-- Diagnostic: every place_coords row, the town it matched (if any), the
-- real km from your list, and the estimate the app was computing before
-- this ran. Rows with "matched_town" = null found no match at all and
-- are still running on the straight-line estimate.
with depot as (
  select d.latitude, d.longitude, coalesce(s.road_factor, 1.3) as road_factor
  from app_settings s
  join depots d on d.depot_key = s.bonus_delivery_depot_key
  where s.id = 1
)
select
  p.place,
  p.parent,
  m.town as matched_town,
  p.depot_distance_km as real_km_now_used,
  round((
    2 * 6371 * asin(sqrt(
      power(sin(radians(depot.latitude - p.latitude) / 2), 2) +
      cos(radians(p.latitude)) * cos(radians(depot.latitude)) *
      power(sin(radians(depot.longitude - p.longitude) / 2), 2)
    )) * depot.road_factor
  )::numeric, 1) as straight_line_estimate_km
from place_coords p
cross join depot
left join lateral (
  select t.town
  from town_distances t
  where pg_temp._norm_town(t.town) = pg_temp._norm_town(p.place)
     or (p.parent is not null and pg_temp._norm_town(t.town) = pg_temp._norm_town(p.parent))
  order by case when pg_temp._norm_town(t.town) = pg_temp._norm_town(p.place) then 0 else 1 end
  limit 1
) m on true
order by (m.town is null), p.place;
