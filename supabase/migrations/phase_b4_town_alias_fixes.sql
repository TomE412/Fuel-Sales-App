-- Commission report — two spelling-variant fixes found in the phase_b2
-- cross-reference results (2026-08-20): place_coords has "Mt Darwin" and
-- "Murehwa" where the user's CSV list spells them "Mount Darwin" and
-- "Murewa" — same real towns, just different abbreviation/transposition.
-- Adds both spellings to town_distances (same distance/province as the
-- original) and re-applies the place_coords match so these two places
-- pick up the real number instead of staying on the estimate.
--
-- Confirmed with user: keep the flat per-town number for Harare-suburb
-- places (parent = "Harare") rather than switching those to their own
-- straight-line estimate — no change needed there, current behavior is
-- already correct.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste ->
-- Run.

insert into town_distances (town, province, distance_km)
select 'Mt Darwin', province, distance_km from town_distances where town = 'Mount Darwin'
union all
select 'Murehwa', province, distance_km from town_distances where town = 'Murewa'
on conflict (town) do update set
  province = excluded.province,
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
  where p2.place in ('Mt Darwin', 'Murehwa')
) m
where m.place_key = p.place and m.rn = 1;

select place, parent, depot_distance_km from place_coords where place in ('Mt Darwin', 'Murehwa');
