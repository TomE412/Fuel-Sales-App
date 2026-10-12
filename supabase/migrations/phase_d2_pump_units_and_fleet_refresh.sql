-- phase_d2_pump_units_and_fleet_refresh.sql
--
-- Two jobs, one paste.
--
-- 1. REFRESH THE FLEET from "logistics trucks summary.xlsx" as it stands on
--    12 Oct 2026. phase_d1 seeded drivers from first names only and had to
--    guess which driver was on which truck. The sheet now settles it, and
--    three of those guesses were wrong:
--
--        SH02  had Norman    -> is Phillip Rateiwa
--        SR04  had Nkosana   -> is Luckson Papaya
--        SR06  had Phillip   -> is Norman Tasvisva
--
--    Also: SR01 has no driver on the register, SR03 is not in the sheet at
--    all, and the driver "Ray" no longer appears. Neither is deleted - both
--    are marked inactive, because delivery_assignment rows may point at them
--    and deleting would break the history a rep can still open.
--
--    ID numbers and phone numbers arrive here for the first time. They are
--    what makes the rep-side "ring the driver" button actually work.
--
-- 2. ADD PUMPING UNITS. A horse and tanker (SH + ST) carries up to 40,000 L
--    and cannot discharge on its own - it needs a pump unit alongside it.
--    A rigid (SR) carries 18,000 L and has its own pump, so it never needs
--    one. That difference is stored on the vehicle as needs_pump rather than
--    inferred from the fleet number, so it can be corrected without a code
--    change.
--
--    SP01 and SP02 are ours. SP03 stands for a unit hired in from another
--    company: it is marked is_hired, carries no reg, driver or number, and
--    the apps show "details to follow" instead of blank fields.
--
-- Safe to run twice. Nothing is deleted.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste the
-- whole thing -> Run. The last table that appears is the result.

-- =====================================================================
-- DRIVERS
-- =====================================================================

-- The seeded short names become the full names on the register. No-ops on a
-- second run, because the short names are gone by then.
update drivers set full_name = 'Pachavo Chitsa'     where full_name = 'Chitsa';
update drivers set full_name = 'Phillip Rateiwa'    where full_name = 'Phillip';
update drivers set full_name = 'Masden Majoni'      where full_name = 'Masden';
update drivers set full_name = 'Paul Mujoma'        where full_name = 'Paul';
update drivers set full_name = 'Simon Shingondo'    where full_name = 'Simon';
update drivers set full_name = 'Peter Musekiwa'     where full_name = 'Peter';
update drivers set full_name = 'Amos Mugarapanyama' where full_name = 'Amos';
update drivers set full_name = 'Washington Bumhira' where full_name = 'Washington';
update drivers set full_name = 'Dennis Chitara'     where full_name = 'Dennis';
update drivers set full_name = 'Nkosana Kanyemba'   where full_name = 'Nkosana';
update drivers set full_name = 'Norman Tasvisva'    where full_name = 'Norman';

-- Renaming rather than re-inserting keeps every existing assignment pointing
-- at the same driver row, so no load loses its driver.
insert into drivers (full_name, id_number, phone) values
  ('Pachavo Chitsa',     '27-080485J27',   '00263772913225'),
  ('Phillip Rateiwa',    '80-024604P42',   '00263772729883'),
  ('Masden Majoni',      '58-00699M26',    '00263772910076'),
  ('Paul Mujoma',        '63-1482377M48',  '00263773756333'),
  ('Simon Shingondo',    '32-096072J32',   '00263772725506'),
  ('Peter Musekiwa',     '05-052655Q05',   '00263773203379'),
  ('Amos Mugarapanyama', '48-008475Z58',   '00263772769730'),
  ('Washington Bumhira', '59-004012V47',   '00263773048003'),
  ('Dennis Chitara',     '08-031114W24',   '00263772885979'),
  ('Luckson Papaya',     '53-1381370X63',  '00263771983037'),
  ('Nkosana Kanyemba',   '59-003178N4A',   '00263772584820'),
  ('Norman Tasvisva',    '25-042582X25',   '00263774063914'),
  ('Bernard',            '63-1149271Q63',  '00263773259308'),
  ('Jairosi',            '50-086079P50',   '00263719286709')
on conflict (full_name) do update set
  id_number = excluded.id_number,
  phone     = excluded.phone,
  active    = true;

-- Not on the current register. Kept so old assignments still read correctly.
update drivers set active = false where full_name = 'Ray';

-- =====================================================================
-- TRAILERS - unchanged from the sheet, refreshed so a re-run is harmless
-- =====================================================================

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

-- =====================================================================
-- VEHICLES
-- =====================================================================

-- Whether this truck needs a pump unit alongside it to discharge.
alter table vehicles add column if not exists needs_pump boolean not null default false;

-- What the rig carries, so the office does not send the 3,500 L runabout
-- to a 40,000 L job. For an SH this is the tanker it pulls, not the horse.
alter table vehicles add column if not exists capacity_litres integer;

-- SR01 is the small flexible vehicle - whoever is free takes it, so it is
-- the one truck that may be assigned without naming a driver.
alter table vehicles add column if not exists driver_optional boolean not null default false;

insert into vehicles (fleet_no, reg_no, model, chassis_no, default_driver_name, default_trip_type, needs_pump, capacity_litres, driver_optional) values
  ('SH01','AEZ 9005','VOLVO', 'YV2RSO2D9GM935382','Pachavo Chitsa',     'collection', true,  40000, false),
  ('SH02','AEZ 9006','VOLVO', 'YV2RSO2D5GM935380','Phillip Rateiwa',    'collection', true,  40000, false),
  ('SH03','AFJ 2570','VOLVO', 'YV2RTY0C3GB761083','Masden Majoni',      'collection', true,  40000, false),
  ('SH04','AFJ 2571','VOLVO', 'YV2RTY0C8GB761094','Paul Mujoma',        'collection', true,  40000, false),
  ('SH05','AFJ 6961','VOLVO', 'YV2RTY0C4GB786719','Simon Shingondo',    'collection', true,  40000, false),
  ('SH06','AFJ 6962','VOLVO', 'YV2RTYOC2HB789619','Peter Musekiwa',     'collection', true,  40000, false),
  ('SH07','AGL 4918','VOLVO', 'YV2RS02D4LM962015','Amos Mugarapanyama', 'collection', true,  40000, false),
  ('SH08','AGL 4917','VOLVO', 'YV2RS02D7MM965878','Washington Bumhira', 'collection', true,  40000, false),
  -- the small runabout: any available driver, no pump needed
  ('SR01','ACQ 3840','SCANIA','A7H32BUM109502334', null,                'delivery',   false,  3500, true ),
  ('SR02','ACQ 3752','VOLVO', 'YV2J4CND73A562147','Dennis Chitara',     'delivery',   false, 18000, false),
  ('SR04','AEG 8887','SCANIA','XLEP640004481745', 'Luckson Papaya',     'delivery',   false, 18000, false),
  ('SR05','ADS 3094','SCANIA','XLEP6X40004481763','Nkosana Kanyemba',   'delivery',   false, 18000, false),
  ('SR06','ADS 3097','SCANIA','YS2P6X40001272956','Norman Tasvisva',    'delivery',   false, 18000, false)
on conflict (fleet_no) do update set
  reg_no              = excluded.reg_no,
  model               = excluded.model,
  chassis_no          = excluded.chassis_no,
  default_driver_name = excluded.default_driver_name,
  default_trip_type   = excluded.default_trip_type,
  needs_pump          = excluded.needs_pump,
  capacity_litres     = excluded.capacity_litres,
  driver_optional     = excluded.driver_optional,
  active              = true;

-- Not in the sheet any more. Kept, not deleted - old loads may point at it.
update vehicles set active = false where fleet_no = 'SR03';

-- Re-point every truck at its driver. Unconditional, because the whole point
-- of this migration is to correct the three that were wrong.
update vehicles v set default_driver_id = d.id
from drivers d
where lower(btrim(d.full_name)) = lower(btrim(v.default_driver_name));

-- SR01 has no driver on the register; clear the stale one.
update vehicles set default_driver_id = null where default_driver_name is null;

-- Trailer pairing, confirmed by the sheet's own driver column: ST04 is
-- Washington's (SH08) and ST08 is Paul's (SH04), so those two cross over.
update vehicles v set default_trailer_id = t.id
from trailers t
where t.trailer_no = case v.fleet_no
    when 'SH01' then 'ST01' when 'SH02' then 'ST02'
    when 'SH03' then 'ST03' when 'SH04' then 'ST08'
    when 'SH05' then 'ST05' when 'SH06' then 'ST06'
    when 'SH07' then 'ST07' when 'SH08' then 'ST04'
    else null end;

-- =====================================================================
-- PUMPING UNITS
-- =====================================================================

create table if not exists pump_units (
  id          uuid primary key default gen_random_uuid(),
  unit_no     text not null unique,
  reg_no      text,
  model       text,
  chassis_no  text,
  driver_id   uuid references drivers(id),
  is_hired    boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- The sheet's "chassis no" column for the pumps holds H100, which is a model
-- variant rather than a chassis number. Recorded as the sheet has it.
insert into pump_units (unit_no, reg_no, model, chassis_no, is_hired) values
  ('SP01', 'AFU 6092', 'Hyundai', 'H100', false),
  ('SP02', 'AFX 9949', 'Hyundai', 'H100', false),
  ('SP03', null,        null,      null,  true)
on conflict (unit_no) do update set
  reg_no     = excluded.reg_no,
  model      = excluded.model,
  chassis_no = excluded.chassis_no,
  is_hired   = excluded.is_hired,
  active     = true;

update pump_units p set driver_id = d.id
from drivers d
where (p.unit_no = 'SP01' and d.full_name = 'Bernard')
   or (p.unit_no = 'SP02' and d.full_name = 'Jairosi');

-- The pump unit that goes with a load. Optional: the office often books the
-- truck before it knows which pump is free, and blocking that would stop
-- them assigning at all.
alter table delivery_assignment add column if not exists pump_unit_id uuid references pump_units(id);

-- =====================================================================
-- WHO CAN SEE AND CHANGE PUMP UNITS
-- =====================================================================
-- Same shape as drivers/trailers: everyone signed in can read (a rep needs
-- the pump driver's number), only ops and admin can change.

alter table pump_units enable row level security;

drop policy if exists pump_units_read on pump_units;
create policy pump_units_read on pump_units for select to authenticated using (true);

drop policy if exists pump_units_write on pump_units;
create policy pump_units_write on pump_units for all to authenticated
  using      (current_user_role() = any (array['ops','admin']))
  with check (current_user_role() = any (array['ops','admin']));

create index if not exists da_pump_idx on delivery_assignment (pump_unit_id);

-- =====================================================================
-- WHAT YOU SHOULD SEE
-- =====================================================================

select 'TRUCK' as kind, v.fleet_no as unit, v.reg_no,
       coalesce(d.full_name, '(no driver on register)') as driver,
       coalesce(d.phone, '-') as contact,
       coalesce(t.trailer_no, '-') as trailer,
       coalesce(v.capacity_litres::text || ' L', '-') as carries,
       case when v.needs_pump then 'pump unit REQUIRED' else 'has its own pump' end as pump,
       case when v.driver_optional then 'any available driver' else 'named driver' end as who_drives,
       case when v.active then 'active' else 'INACTIVE - not in the sheet' end as state
from vehicles v
left join drivers d  on d.id = v.default_driver_id
left join trailers t on t.id = v.default_trailer_id
union all
select 'PUMP', p.unit_no, coalesce(p.reg_no,'-'),
       coalesce(d.full_name, case when p.is_hired then '(hired in - details on the day)' else '(none)' end),
       coalesce(d.phone,'-'), '-', '-',
       case when p.is_hired then 'hired from another company' else 'ours' end,
       '-',
       case when p.active then 'active' else 'inactive' end
from pump_units p
left join drivers d on d.id = p.driver_id
order by kind desc, unit;
