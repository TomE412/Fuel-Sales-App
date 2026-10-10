-- check_fleet_state.sql — READ ONLY. Changes nothing.
--
-- What already exists for truck / trailer / driver assignment, so the build
-- starts from the live database rather than from what the migration files say.
-- phase_a2 (the 14-vehicle fleet with reg numbers) is one of several files
-- that may never have been run.

select 'table: vehicles' as item,
       case when to_regclass('public.vehicles') is null then 'MISSING'
            else 'exists' end as state,
       coalesce((select count(*)::text from vehicles), '-') as rows
union all
select 'table: trucks',
       case when to_regclass('public.trucks') is null then 'MISSING' else 'exists' end,
       coalesce((select count(*)::text from trucks), '-')
union all
select 'table: delivery_plan',
       case when to_regclass('public.delivery_plan') is null then 'MISSING' else 'exists' end,
       coalesce((select count(*)::text from delivery_plan), '-')
union all
select 'table: drivers',
       case when to_regclass('public.drivers') is null then 'MISSING - would need creating' else 'exists' end,
       '-'
union all
select 'table: trailers',
       case when to_regclass('public.trailers') is null then 'MISSING - would need creating' else 'exists' end,
       '-'

-- did phase_a2 ever run? these columns are the tell
union all
select 'vehicles.reg_no',
       case when exists (select 1 from information_schema.columns
                         where table_schema='public' and table_name='vehicles' and column_name='reg_no')
            then 'exists' else 'MISSING - phase_a2 never ran' end, '-'
union all
select 'vehicles.default_driver_name',
       case when exists (select 1 from information_schema.columns
                         where table_schema='public' and table_name='vehicles' and column_name='default_driver_name')
            then 'exists' else 'MISSING - phase_a2 never ran' end, '-'

-- anything already on delivery_plan beyond the truck?
union all
select 'delivery_plan columns',
       coalesce((select string_agg(column_name, ', ' order by ordinal_position)
                 from information_schema.columns
                 where table_schema='public' and table_name='delivery_plan'), 'n/a'), '-'

-- and the active fleet, if it is there
union all
select 'active trucks (lanes)',
       coalesce((select count(*)::text from trucks where active), '-'), '-'
order by item;
