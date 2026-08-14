-- Driver Bonus Calculator — Phase A, part 3
-- Seeds bonus_delivery_bands from the "Pump & Deliver Truck" sheet.
-- Bands are inclusive at both ends as printed (50-100, 101-200, ...).
-- Safe to re-run (upserts by min_km).
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste ->
-- Run. Independent of the other Phase A files; run any time after
-- phase_a_driver_bonus_schema.sql.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bonus_delivery_bands_min_km_uniq'
  ) then
    alter table bonus_delivery_bands
      add constraint bonus_delivery_bands_min_km_uniq unique (min_km);
  end if;
end $$;

insert into bonus_delivery_bands (min_km, max_km, bonus_amount) values
  (50, 100, 10),
  (101, 200, 20),
  (201, 300, 30),
  (301, null, 45)
on conflict (min_km) do update set
  max_km = excluded.max_km,
  bonus_amount = excluded.bonus_amount;
