-- Driver Bonus Calculator — Phase A, part 2
-- Adds a few descriptive columns to `vehicles` (reg_no/model/chassis_no/
-- default_driver_name — useful for Munya's reference, not used in bonus
-- math) that weren't in the first migration, then seeds the real
-- 14-vehicle fleet list from the truck register photo.
--
-- Safe to run whether or not phase_a_driver_bonus_schema.sql has already
-- been run, and safe to re-run (upserts by fleet_no instead of erroring
-- on duplicates).
--
-- HOW TO RUN: same as before — Supabase dashboard → SQL Editor → New
-- query → paste → Run. Run this AFTER phase_a_driver_bonus_schema.sql.
--
-- DOUBLE-CHECK: driver name spelling below was read off a photo — please
-- skim the list against the real register before/after running.

alter table vehicles add column if not exists reg_no text;
alter table vehicles add column if not exists model text;
alter table vehicles add column if not exists chassis_no text;
alter table vehicles add column if not exists default_driver_name text;

insert into vehicles (fleet_no, reg_no, model, chassis_no, default_driver_name, default_trip_type)
values
  ('SH01','AEZ 9005','VOLVO','YV2RSO2D9GM935382','Chitsa','collection'),
  ('SH02','AEZ 9006','VOLVO','YV2RSO2D5GM935380','Norman','collection'),
  ('SH03','AFJ 2570','VOLVO','YV2RTY0C3GB761083','Masden','collection'),
  ('SH04','AFJ 2571','VOLVO','YV2RTY0C8GB761094','Paul','collection'),
  ('SH05','AFJ 6961','VOLVO','YV2RTY0C4GB786719','Simon','collection'),
  ('SH06','AFJ 6962','VOLVO','YV2RTYOC2HB789619','Peter','collection'),
  ('SH07','AGL 4918','VOLVO','YV2RS02D4LM962015','Amos','collection'),
  ('SH08','AGL 4917','VOLVO','YV2RS02D7MM965878','Washington','collection'),
  ('SR01','ACQ 3840','SCANIA','A7H32BUM109502334','Phillip','delivery'),
  ('SR02','ACQ 3752','VOLVO','YV2J4CND73A562147','Dennis','delivery'),
  ('SR03','ACE 3087','SCANIA','YSP6X40001272931','Ray','delivery'),
  ('SR04','AEG 8887','SCANIA','XLEP640004481745','Nkosana','delivery'),
  ('SR05','ADS 3094','SCANIA','XLEP6X40004481763','Nkosana','delivery'),
  ('SR06','ADS 3097','SCANIA','YS2P6X40001272956','Phillip','delivery')
on conflict (fleet_no) do update set
  reg_no = excluded.reg_no,
  model = excluded.model,
  chassis_no = excluded.chassis_no,
  default_driver_name = excluded.default_driver_name,
  default_trip_type = excluded.default_trip_type;
