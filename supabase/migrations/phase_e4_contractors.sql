-- phase_e4_contractors.sql
--
-- HIRING IN A TRUCK.
--
-- When Skelsee's own fleet is full, a load goes out on a truck contracted
-- from another transporter. Until now there was nowhere to record that: the
-- rig picker only offered our fourteen trucks, so the load either went out
-- unassigned or was booked onto a Skelsee truck that was not really doing it.
--
-- THE SHAPE, and why:
--
--   A contracted truck is stored as a TRUCK, in `vehicles`, alongside SH01
--   and SR02 - it is simply tagged with the transporter that owns it. That
--   one decision is what makes everything downstream free. The delivery
--   board, the rep's app, the "ring the driver" button, the WhatsApp job
--   sheet and the notify-rep function all read a vehicle, a driver and a
--   pump unit by id. None of them asks who owns it, so none of them changes.
--
--   The same goes for the driver, the trailer and the pumping unit. Each
--   gains one column saying whose it is, and nothing else moves.
--
--   `delivery_assignment` is NOT touched at all.
--
-- WHAT IS DELIBERATELY NOT DONE HERE:
--
--   `drivers.full_name` keeps its UNIQUE constraint. Two transporters could
--   each employ a John Moyo, and the honest fix would be a partial unique
--   index per owner - but phase_d2 relies on `on conflict (full_name)`, and
--   that inference stops working the moment the plain unique index goes.
--   Breaking a migration that is documented as safe to re-run is a worse
--   trade than the app handling a name clash, which it does: a second
--   John Moyo is stored as "John Moyo (ZIM)" using the transporter's code.
--
-- Safe to run twice. Nothing is deleted and no existing row is changed.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste PART 1,
-- Run, read it. Then paste PART 2, Run. Then PART 3.


-- ===========================================================
-- PART 1 - LOOK ONLY. Nothing is changed by this.
--
-- Reads the system catalogue and NOTHING else. An earlier version of this
-- part counted the rows in `contractors` inside a case branch guarded by
-- to_regclass, which cannot work: Postgres resolves every table named in a
-- query before executing any of it, so the whole statement failed with
-- 42P01 on the table it was there to check for. A look-only query must not
-- name a table whose existence is in question.
-- ===========================================================

select 'contractors table' as item,
       case when to_regclass('public.contractors') is null
            then 'MISSING - Part 2 creates it' else 'already exists' end as state
union all
select 'vehicles table',
       case when to_regclass('public.vehicles') is null
            then 'MISSING - run phase_d1 first' else 'exists' end
union all
select 'drivers table',
       case when to_regclass('public.drivers') is null
            then 'MISSING - run phase_d1 first' else 'exists' end
union all
select 'trailers table',
       case when to_regclass('public.trailers') is null
            then 'MISSING - run phase_d1 first' else 'exists' end
union all
select 'pump_units table',
       case when to_regclass('public.pump_units') is null
            then 'MISSING - run phase_d2 first' else 'exists' end
union all
select 'vehicles.contractor_id',
       case when exists (select 1 from information_schema.columns
                         where table_schema='public' and table_name='vehicles'
                           and column_name='contractor_id')
            then 'already there' else 'MISSING - Part 2 adds it' end
union all
select 'pump_units.is_hired',
       case when exists (select 1 from information_schema.columns
                         where table_schema='public' and table_name='pump_units'
                           and column_name='is_hired')
            then 'exists' else 'MISSING - run phase_d2 first' end
union all
select 'current_user_role() helper',
       case when to_regprocedure('public.current_user_role()') is null
            then 'MISSING - the write policy below needs it'
            else 'exists' end;


-- ===========================================================
-- PART 2 - BUILD.
-- ===========================================================

-- --- the transporters themselves ----------------------------------------
-- This IS the preferred-contractor list. It grows by one row the first time
-- a company is used and is never emptied: a transporter you have stopped
-- using is marked inactive so the loads they carried still read correctly.
create table if not exists contractors (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,     -- as it is written on their invoice
  code         text not null unique,     -- 3-4 letters, builds unit numbers: ZIM -> ZIM1
  contact_name text,
  phone        text,                     -- the office, not the driver
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   text
);

-- --- whose truck, driver, trailer and pump is it ------------------------
-- NULL means Skelsee's own. That is what every existing row already is, so
-- no backfill is needed and nothing changes for the current fleet.
alter table vehicles   add column if not exists contractor_id uuid references contractors(id);
alter table drivers    add column if not exists contractor_id uuid references contractors(id);
alter table trailers   add column if not exists contractor_id uuid references contractors(id);
alter table pump_units add column if not exists contractor_id uuid references contractors(id);

create index if not exists vehicles_contractor_idx   on vehicles   (contractor_id);
create index if not exists drivers_contractor_idx    on drivers    (contractor_id);
create index if not exists trailers_contractor_idx   on trailers   (contractor_id);
create index if not exists pump_units_contractor_idx on pump_units (contractor_id);

-- --- who can see and change them ----------------------------------------
-- Exactly the shape drivers, trailers and pump_units already use: anyone
-- signed in can read, only ops and administrators can change. A rep reads
-- it so the app can tell them the load is on a hired truck.
alter table contractors enable row level security;

drop policy if exists contractors_read on contractors;
create policy contractors_read on contractors
  for select to authenticated using (true);

drop policy if exists contractors_write on contractors;
create policy contractors_write on contractors for all to authenticated
  using      (current_user_role() = any (array['ops','admin']))
  with check (current_user_role() = any (array['ops','admin']));

-- A hired pump unit is now identified by its owner rather than by a flag on
-- a placeholder row, so keep is_hired agreeing with contractor_id. SP03 -
-- the old "hired in, details on the day" placeholder - has no owner, so it
-- is left exactly as it is and simply stops being offered by the app.
update pump_units set is_hired = true
 where contractor_id is not null and is_hired = false;


-- ===========================================================
-- PART 3 - CHECK.
--
-- Expect: contractors 0 rows (nothing hired in yet), and every one of the
-- four "owned by Skelsee" counts equal to that table's total, because no
-- existing row has an owner.
-- ===========================================================

select 'contractors on file'        as item, count(*)::text as n from contractors
union all select 'vehicles - Skelsee''s own',   count(*)::text from vehicles   where contractor_id is null
union all select 'vehicles - hired in',         count(*)::text from vehicles   where contractor_id is not null
union all select 'drivers - Skelsee''s own',    count(*)::text from drivers    where contractor_id is null
union all select 'drivers - hired in',          count(*)::text from drivers    where contractor_id is not null
union all select 'trailers - Skelsee''s own',   count(*)::text from trailers   where contractor_id is null
union all select 'pump units - Skelsee''s own', count(*)::text from pump_units where contractor_id is null
order by item;
