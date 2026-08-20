-- Commission report — set Ruwa as the depot-distance reference point
-- Confirmed with user: their fuel depot (tanks) is physically in Ruwa.
-- Fuel is received from NOIC Feruka (Mutare) and occasionally trucked
-- straight from there to a customer to save double-handling, but for
-- simplicity the user wants EVERY commission distance measured from
-- Ruwa regardless of which route the truck actually took.
--
-- Root cause of the phase_b2 diagnostic returning "no rows": the
-- app_settings.bonus_delivery_depot_key that admin/index.html's
-- SalesApp.loadDepotRef() reads was NULL, so it silently fell back to
-- the first depot by sort_order — "Harare - Msasa", not Ruwa. Msasa and
-- Ruwa are ~15-20km apart, which matters at this scale, and neither
-- existing depot row (Harare - Msasa, Mutare - Feruka NOIC) represents
-- the Ruwa depot at all.
--
-- Coordinates below are Ruwa town-center (-17.8895, 31.2436), not a
-- pin on the exact tank site — user didn't have an exact GPS pin handy.
-- Good enough for "relatively accurate" per the user's own bar, but if
-- they later drop a precise pin, update this row's latitude/longitude
-- directly rather than re-running this whole script.
--
-- Does NOT change which depot Logistics/route-planning defaults to
-- (that still defaults to whichever depot sorts first) — this only
-- wires up the commission-report reference point. Ask before widening
-- scope to Logistics if that's also wanted.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste ->
-- Run. Then re-run phase_b2_town_distances.sql's diagnostic SELECT (the
-- last statement in that file) to see the real cross-reference now that
-- the depot is set.

-- Uses an explicit exists-check rather than ON CONFLICT since depots'
-- schema isn't tracked in this repo (set up directly in the dashboard)
-- and depot_key isn't confirmed to have a unique constraint.
do $$
begin
  if exists (select 1 from depots where depot_key = 'ruwa') then
    update depots set
      depot_name = 'Ruwa (Fuel Depot)',
      latitude = -17.8895,
      longitude = 31.2436,
      active = true
    where depot_key = 'ruwa';
  else
    insert into depots (depot_key, depot_name, latitude, longitude, sort_order, active)
    values ('ruwa', 'Ruwa (Fuel Depot)', -17.8895, 31.2436, 3, true);
  end if;
end $$;

update app_settings set bonus_delivery_depot_key = 'ruwa' where id = 1;

select id, road_factor, bonus_delivery_depot_key from app_settings;
