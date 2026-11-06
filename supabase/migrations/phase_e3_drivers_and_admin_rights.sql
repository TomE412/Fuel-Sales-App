-- phase_e3_drivers_and_admin_rights.sql
--
-- Two small things, both needed before the Drivers list can work.
--
-- 1. `vehicles` has row-level security switched ON and not one write policy.
--    The standing allocation - which driver and which trailer belong to which
--    truck - lives in that table. Without this the new screen would save
--    nothing, and it would do it SILENTLY: row-level security refuses a write
--    by matching zero rows and reporting no error at all.
--
-- 2. Every administrator gets the People page, not just Tom. The tab, the
--    profiles_guard trigger and the manage-users function all key off the one
--    `can_manage_users` flag, so granting the flag is the whole change - no
--    redeploy, no app edit.
--
-- RUN PART 1 FIRST, read it, THEN PART 2. Both are safe to re-run.


-- ===========================================================
-- PART 1 - LOOK ONLY. Nothing is changed by this.
-- ===========================================================
select 'vehicles: row-level security'::text as what,
       (case when c.relrowsecurity then 'ON' else 'OFF' end)::text as state
from pg_class c where c.oid = 'public.vehicles'::regclass
union all
select 'vehicles: write policies today',
       (select count(*)::text from pg_policies where schemaname = 'public'
         and tablename = 'vehicles' and cmd in ('ALL','UPDATE','INSERT'))
union all
select 'administrators',
       (select count(*)::text from profiles where role = 'admin')
union all
select 'administrators who can manage people',
       (select count(*)::text from profiles
         where role = 'admin' and coalesce(can_manage_users,false))
union all
select 'drivers on file',
       (select count(*)::text from drivers where active)
union all
select 'drivers with no phone number',
       (select count(*)::text from drivers
         where active and coalesce(phone,'') = '')
union all
select 'drivers with no ID number',
       (select count(*)::text from drivers
         where active and coalesce(id_number,'') = '')
union all
select 'trucks with a standing driver',
       (select count(*)::text from vehicles
         where active and default_driver_id is not null)
union all
select 'trucks with NO standing driver',
       (select count(*)::text from vehicles
         where active and default_driver_id is null);


-- ===========================================================
-- PART 2 - THE CHANGE. Run this once Part 1 has been read.
-- ===========================================================

-- Only ops and admin may change the standing allocation. Reps keep whatever
-- read access they already have: this is an extra permissive policy, so it
-- adds a right to write and takes nothing away.
drop policy if exists vehicles_write on vehicles;
create policy vehicles_write on vehicles for all to authenticated
  using      (current_user_role() = any (array['ops','admin']))
  with check (current_user_role() = any (array['ops','admin']));

-- Every administrator can now add and remove staff.
--
-- This runs in the SQL Editor, which carries no JWT, and profiles_guard lets
-- a claim-less caller through by design - that is the owner, not a signed-in
-- user. From inside the apps the guard still holds.
update profiles
   set can_manage_users = true
 where role = 'admin'
   and coalesce(can_manage_users, false) = false;


-- ===========================================================
-- CHECK - this must return two rows, both reading as expected.
-- ===========================================================
select 'vehicles write policy'::text as what,
       (case when exists (select 1 from pg_policies
               where schemaname = 'public' and tablename = 'vehicles'
                 and policyname = 'vehicles_write')
             then 'INSTALLED' else 'MISSING - Part 2 did not run' end)::text as state
union all
select 'administrators who can manage people',
       (select count(*)::text from profiles
         where role = 'admin' and coalesce(can_manage_users,false));
