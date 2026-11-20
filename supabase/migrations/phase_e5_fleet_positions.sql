-- phase_e5_fleet_positions.sql
--
-- WHERE THE FLEET IS, as a note on today's map.
--
-- Munya drags a truck or a pumping unit onto the ops map to show roughly
-- where it is. That has to survive the page being closed, or he would
-- re-place the whole fleet every morning and nobody else would ever see it.
--
-- WHY A TABLE OF ITS OWN, rather than four columns on `vehicles` and four
-- more on `pump_units`:
--
--   * one read, one save path, one security policy instead of two of each
--   * the next kind of unit needs no migration, only a new `kind`
--   * and the honest reason: where a truck is parked today is NOT a fact
--     about the truck. `vehicles` describes the vehicle. This describes the
--     morning. Keeping them apart means a position can be wiped without
--     touching the fleet register.
--
-- `unit_id` carries NO foreign key, because one column cannot reference two
-- different tables. Nothing is lost by that: vehicles and pump units are
-- never deleted (they are marked inactive), and the apps only draw a
-- position whose unit is in their own active list, so a stray row is
-- invisible rather than wrong.
--
-- Taking a unit off the map DELETES its row. The table therefore only ever
-- holds what somebody is actually looking at.
--
-- Safe to run twice. Nothing existing is altered.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste PART 1,
-- Run, read it. Then PART 2. Then PART 3.


-- ===========================================================
-- PART 1 - LOOK ONLY. Reads the catalogue and nothing else, so it
-- cannot fail on a table it is checking for.
-- ===========================================================

select 'fleet_positions table' as item,
       case when to_regclass('public.fleet_positions') is null
            then 'MISSING - Part 2 creates it' else 'already exists' end as state
union all
select 'vehicles table',
       case when to_regclass('public.vehicles') is null
            then 'MISSING - run phase_d1 first' else 'exists' end
union all
select 'pump_units table',
       case when to_regclass('public.pump_units') is null
            then 'MISSING - run phase_d2 first' else 'exists' end
union all
select 'contractors table',
       case when to_regclass('public.contractors') is null
            then 'MISSING - run phase_e4 first' else 'exists' end
union all
select 'place_coords table',
       case when to_regclass('public.place_coords') is null
            then 'MISSING - the orders layer needs it' else 'exists' end
union all
select 'current_user_role() helper',
       case when to_regprocedure('public.current_user_role()') is null
            then 'MISSING - the write policy below needs it' else 'exists' end;


-- ===========================================================
-- PART 2 - BUILD.
-- ===========================================================

create table if not exists fleet_positions (
  kind       text not null check (kind in ('vehicle','pump')),
  unit_id    uuid not null,
  latitude   double precision not null,
  longitude  double precision not null,
  moved_at   timestamptz not null default now(),
  moved_by   text,
  primary key (kind, unit_id)
);

-- Zimbabwe is roughly 15.6-22.4 S and 25.2-33.1 E. A position well outside
-- that is a dropped decimal point or a swapped pair, not a truck - and the
-- map draws whatever is in here, so it is worth refusing at the door.
-- Generous on purpose: this is about catching nonsense, not policing borders.
alter table fleet_positions drop constraint if exists fleet_positions_sane;
alter table fleet_positions add constraint fleet_positions_sane
  check (latitude between -26 and -12 and longitude between 22 and 36);

-- --- who can see and change them ----------------------------------------
-- Everyone signed in can READ: the whole point is one shared picture of
-- where things are. Only ops and administrators move anything, same as
-- every other logistics write.
alter table fleet_positions enable row level security;

drop policy if exists fleet_positions_read on fleet_positions;
create policy fleet_positions_read on fleet_positions
  for select to authenticated using (true);

drop policy if exists fleet_positions_write on fleet_positions;
create policy fleet_positions_write on fleet_positions for all to authenticated
  using      (current_user_role() = any (array['ops','admin']))
  with check (current_user_role() = any (array['ops','admin']));


-- ===========================================================
-- PART 3 - CHECK.
--
-- Expect: the table exists, 0 rows (nothing placed yet), 2 policies, and
-- the counts of what there is to place.
-- ===========================================================

select 'positions placed'            as item, count(*)::text as n from fleet_positions
union all select 'policies on the table',     count(*)::text from pg_policies
  where schemaname='public' and tablename='fleet_positions'
union all select 'trucks to place - ours',    count(*)::text from vehicles
  where active and contractor_id is null
union all select 'trucks to place - hired in', count(*)::text from vehicles
  where active and contractor_id is not null
union all select 'pumping units to place',    count(*)::text from pump_units where active
union all select 'towns with coordinates',    count(*)::text from place_coords
  where latitude is not null and longitude is not null
order by item;
