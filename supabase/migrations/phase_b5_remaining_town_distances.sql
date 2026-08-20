-- Commission report — last 4 real distances the user provided directly
-- (2026-08-20), for the places phase_b2's cross-reference found with no
-- match in the original 88-town CSV: Honde Valley, Madziva, Mount
-- Hampden, Nyabira. Province left null (not given, not needed for the
-- distance calc). "Kamativi" still has no real number and stays on the
-- straight-line estimate — nobody's provided one yet.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste ->
-- Run.

insert into town_distances (town, province, distance_km) values
  ('Honde Valley', null, 286),
  ('Madziva', null, 157),
  ('Mount Hampden', null, 10),
  ('Nyabira', null, 58)
on conflict (town) do update set
  distance_km = excluded.distance_km;

create or replace function pg_temp._norm_town(text) returns text as $$
  select regexp_replace(lower($1), '[^a-z0-9]+', '', 'g')
$$ language sql immutable;

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
  where p2.place in ('Honde Valley', 'Madziva', 'Mount Hampden', 'Nyabira')
) m
where m.place_key = p.place and m.rn = 1;

select place, parent, depot_distance_km from place_coords
where place in ('Honde Valley', 'Madziva', 'Mount Hampden', 'Nyabira', 'Kamativi');
