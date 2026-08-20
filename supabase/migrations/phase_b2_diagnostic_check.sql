-- Diagnostic only, not a migration — checks why the phase_b2 diagnostic
-- query returned no rows. Run in Supabase SQL Editor and share the
-- results (four small result sets, one per query below).

select count(*) as place_coords_rows from place_coords;

select count(*) as town_distances_rows from town_distances;

select id, road_factor, bonus_delivery_depot_key from app_settings;

select * from depots;
