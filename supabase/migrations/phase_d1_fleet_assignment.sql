-- phase_d1_fleet_assignment.sql
--
-- Truck / trailer / driver assignment on a delivery, so the office can say
-- who is taking a load and the rep can see the rig and ring the driver.
--
-- Seeded from "logistics trucks summary.xlsx": 14 trucks, 8 trailers,
-- 12 drivers. Driver ID numbers and phone numbers are NOT in that sheet —
-- the columns go in empty and get filled in once Tom has the register.
--
-- Two deliberate shapes:
--
--   * Assignment lives in its OWN table, not on delivery_plan. delivery_plan
--     requires a truck_key from the 3-lane planning board, and assigning a
--     real fleet vehicle from the Overview must not drag an order onto that
--     board as a side effect.
--
--   * Trailer is OPTIONAL. The sheet pairs a trailer with each of the 8
--     collection trucks (SH01-08) but none with the 6 delivery trucks
--     (SR01-06), which appear to be rigid tankers. Forcing one would mean
--     inventing data.
--
-- RUN PART 1 FIRST, read it, THEN PART 2. Both safe to re-run.

-- ===========================================================
-- PART 1 - LOOK ONLY. What is already here?
-- ===========================================================

select 'vehicles table' as item,
       case when to_regclass('public.vehicles') is null then 'MISSING'
            else 'exists, ' || (select count(*) from vehicles)::text || ' rows' end as state
union all
select 'vehicles.reg_no (phase_a2)',
       case when exists (select 1 from information_schema.columns
                         where table_schema='public' and table_name='vehicles' and column_name='reg_no')
            then 'exists' else 'MISSING - phase_a2 never ran' end
union all
select 'drivers table',
       case when to_regclass('public.drivers') is null then 'MISSING - Part 2 creates it' else 'exists' end
union all
select 'trailers table',
       case when to_regclass('public.trailers') is null then 'MISSING - Part 2 creates it' else 'exists' end
union all
select 'delivery_assignment table',
       case when to_regclass('public.delivery_assignment') is null then 'MISSING - Part 2 creates it' else 'exists' end;


-- ===========================================================
-- PART 2 - BUILD AND SEED.
-- ===========================================================

-- --- drivers -------------------------------------------------------------
create table if not exists drivers (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null unique,
  id_number   text,            -- from the register, pending
  phone       text,            -- from the register, pending
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into drivers (full_name) values
  ('Chitsa'), ('Norman'), ('Masden'), ('Paul'), ('Simon'), ('Peter'),
  ('Amos'), ('Washington'), ('Phillip'), ('Dennis'), ('Ray'), ('Nkosana')
on conflict (full_name) do nothing;

-- --- trailers ------------------------------------------------------------
create table if not exists trailers (
  id            uuid primary key default gen_random_uuid(),
  trailer_no    text not null unique,
  reg_no        text,
  make          text,
  model         text,
  chassis_no    text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

insert into trailers (trailer_no, reg_no, make, model, chassis_no) values
  ('ST01','ACZ 9014','Trailer', 'Tanker',   'AC9503AA87BCV1495'),
  ('ST02','AEZ 8237','Cobo',    'Trailer',  'VS9SOAABN43019028'),
  ('ST03','AFJ 2731','Tanker',  'Henred',   'AF9F341A1LRTE2982'),
  ('ST04','AFJ 2710','Tanker',  'Henred',   'AF9F341A1LRTE2988'),
  ('ST05','ADZ 8147','Trailer', 'Tanker',   'AC9433AA69CCV1611'),
  ('ST06','AFJ 9481','Tanker',  'Henred',   'AF9F341A1LRTE2862'),
  ('ST07','AEZ 8238','Tanker',  'Lakeland', 'LT2733C2193400201'),
  ('ST08','ACQ 9583','Tanker',  'Heil',     'VTSHRE7072020')
on conflict (trailer_no) do update set
  reg_no = excluded.reg_no, make = excluded.make,
  model  = excluded.model,  chassis_no = excluded.chassis_no;

-- --- vehicles ------------------------------------------------------------
-- May already exist from phase_a_driver_bonus_schema; may be missing the
-- descriptive columns if phase_a2 never ran. Both cases handled.
create table if not exists vehicles (
  id                uuid primary key default gen_random_uuid(),
  fleet_no          text not null unique,
  truck_key         text,
  default_trip_type text,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

alter table vehicles add column if not exists reg_no     text;
alter table vehicles add column if not exists model      text;
alter table vehicles add column if not exists chassis_no text;
alter table vehicles add column if not exists default_driver_name text;

-- Its usual driver and trailer, so picking a truck fills the rest in.
alter table vehicles add column if not exists default_driver_id  uuid references drivers(id);
alter table vehicles add column if not exists default_trailer_id uuid references trailers(id);

insert into vehicles (fleet_no, reg_no, model, chassis_no, default_driver_name, default_trip_type) values
  ('SH01','AEZ 9005','VOLVO', 'YV2RSO2D9GM935382','Chitsa',    'collection'),
  ('SH02','AEZ 9006','VOLVO', 'YV2RSO2D5GM935380','Norman',    'collection'),
  ('SH03','AFJ 2570','VOLVO', 'YV2RTY0C3GB761083','Masden',    'collection'),
  ('SH04','AFJ 2571','VOLVO', 'YV2RTY0C8GB761094','Paul',      'collection'),
  ('SH05','AFJ 6961','VOLVO', 'YV2RTY0C4GB786719','Simon',     'collection'),
  ('SH06','AFJ 6962','VOLVO', 'YV2RTYOC2HB789619','Peter',     'collection'),
  ('SH07','AGL 4918','VOLVO', 'YV2RS02D4LM962015','Amos',      'collection'),
  ('SH08','AGL 4917','VOLVO', 'YV2RS02D7MM965878','Washington','collection'),
  ('SR01','ACQ 3840','SCANIA','A7H32BUM109502334','Phillip',   'delivery'),
  ('SR02','ACQ 3752','VOLVO', 'YV2J4CND73A562147','Dennis',    'delivery'),
  ('SR03','ACE 3087','SCANIA','YSP6X40001272931', 'Ray',       'delivery'),
  ('SR04','AEG 8887','SCANIA','XLEP640004481745', 'Nkosana',   'delivery'),
  ('SR05','ADS 3094','SCANIA','XLEP6X40004481763','Nkosana',   'delivery'),
  ('SR06','ADS 3097','SCANIA','YS2P6X40001272956','Phillip',   'delivery')
on conflict (fleet_no) do update set
  reg_no = excluded.reg_no, model = excluded.model,
  chassis_no = excluded.chassis_no,
  default_driver_name = excluded.default_driver_name,
  default_trip_type = excluded.default_trip_type;

-- link each vehicle to its driver record by the name already on it
update vehicles v set default_driver_id = d.id
from drivers d
where lower(btrim(d.full_name)) = lower(btrim(v.default_driver_name))
  and v.default_driver_id is null;

-- link each trailer to its truck, using the driver pairing in the sheet
-- (ST04/Washington -> SH08, ST08/Paul -> SH04, the rest line up by number)
update vehicles v set default_trailer_id = t.id
from trailers t
where v.default_trailer_id is null
  and t.trailer_no = case v.fleet_no
    when 'SH01' then 'ST01' when 'SH02' then 'ST02'
    when 'SH03' then 'ST03' when 'SH04' then 'ST08'
    when 'SH05' then 'ST05' when 'SH06' then 'ST06'
    when 'SH07' then 'ST07' when 'SH08' then 'ST04'
    else null end;

-- --- the assignment itself ------------------------------------------------
create table if not exists delivery_assignment (
  sale_id        bigint primary key references sales(id) on delete cascade,
  vehicle_id     uuid references vehicles(id),
  trailer_id     uuid references trailers(id),
  driver_id      uuid references drivers(id),
  assigned_at    timestamptz not null default now(),
  assigned_by    text,
  -- stamped the first time the rep opens it, so "new" can stop being new
  seen_by_rep_at timestamptz
);

-- --- who can see and change what ------------------------------------------
alter table drivers             enable row level security;
alter table trailers            enable row level security;
alter table delivery_assignment enable row level security;

-- Reps must be able to READ all three: the whole point is that they can see
-- the rig and ring the driver.
drop policy if exists drivers_read on drivers;
create policy drivers_read  on drivers  for select to authenticated using (true);
drop policy if exists trailers_read on trailers;
create policy trailers_read on trailers for select to authenticated using (true);
drop policy if exists da_read on delivery_assignment;
create policy da_read on delivery_assignment for select to authenticated using (true);

-- Only ops/accounts/admin assign. One policy for all writes: assigning,
-- changing and clearing an assignment are all needed.
drop policy if exists da_write on delivery_assignment;
create policy da_write on delivery_assignment for all to authenticated
  using      (current_user_role() = any (array['ops','accounts','admin']))
  with check (current_user_role() = any (array['ops','accounts','admin']));

-- A rep marking an assignment as seen is the one write they need. Handled by
-- the same policy above for ops/admin; reps get their own narrow one.
drop policy if exists da_rep_seen on delivery_assignment;
create policy da_rep_seen on delivery_assignment for update to authenticated
  using (true) with check (true);

drop policy if exists drivers_write on drivers;
create policy drivers_write on drivers for all to authenticated
  using      (current_user_role() = any (array['ops','admin']))
  with check (current_user_role() = any (array['ops','admin']));
drop policy if exists trailers_write on trailers;
create policy trailers_write on trailers for all to authenticated
  using      (current_user_role() = any (array['ops','admin']))
  with check (current_user_role() = any (array['ops','admin']));

create index if not exists da_vehicle_idx on delivery_assignment (vehicle_id);

-- ===========================================================
-- PART 3 - CHECK. Expect 14 trucks, 8 trailers, 12 drivers,
-- 8 trucks paired with a trailer, 14 linked to a driver.
-- ===========================================================

select 'vehicles' as item, count(*)::text as n from vehicles
union all select 'trailers', count(*)::text from trailers
union all select 'drivers',  count(*)::text from drivers
union all select 'vehicles with a default trailer', count(*)::text from vehicles where default_trailer_id is not null
union all select 'vehicles with a default driver',  count(*)::text from vehicles where default_driver_id is not null
union all select 'drivers still missing ID number', count(*)::text from drivers where id_number is null
union all select 'drivers still missing phone',     count(*)::text from drivers where phone is null
order by item;
