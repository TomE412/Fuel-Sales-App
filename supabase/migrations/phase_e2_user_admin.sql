-- phase_e2_user_admin.sql
--
-- Everything the People page needs. Run AFTER phase_e1b (the guard).
--
-- Nothing in here changes what anybody can reach today. app_access starts
-- empty, and empty means "work it out from their role, exactly as before", so
-- this file cannot lock anyone out. Access only starts changing when Tom
-- ticks a box.


-- ===========================================================
-- 1. Which apps a person may open
-- ===========================================================
-- NULL on purpose, not an empty array. NULL means "not set, carry on as
-- before"; an empty array would mean "this person may open nothing", and
-- defaulting everyone to that would lock the whole company out on the day
-- this runs.
alter table profiles add column if not exists app_access text[];

-- Someone who has left, or a login being parked. Still listed, still attached
-- to their old sales, simply cannot get in.
alter table profiles add column if not exists active boolean not null default true;


-- ===========================================================
-- 2. Who may manage people — as a function
-- ===========================================================
-- This has to be a SECURITY DEFINER function rather than a subquery written
-- straight into the policy. A policy on profiles that reads profiles sends
-- Postgres round in circles and errors out; a definer function reads the
-- table without row-level security applying, which breaks the loop. Same
-- reason current_user_role() exists.
create or replace function current_user_can_manage_users()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.can_manage_users from profiles p where p.id = auth.uid()), false)
$$;


-- ===========================================================
-- 3. Let a user administrator edit other people
-- ===========================================================
-- Without this the People page would look like it worked and change nothing:
-- row-level security refuses an UPDATE by matching zero rows and reporting
-- no error at all, so every tick box would fail in silence.
--
-- Added alongside whatever policies already exist rather than replacing them.
-- Postgres allows a row through if ANY policy allows it, so this grants the
-- administrator the extra reach and leaves everyone else's rules untouched.
drop policy if exists profiles_manager_update on profiles;
create policy profiles_manager_update on profiles
  for update to authenticated
  using      (current_user_can_manage_users())
  with check (current_user_can_manage_users());

-- The page also has to list everybody. Admins can already read every row, but
-- this makes it true for the user administrator specifically, so the page does
-- not quietly depend on also happening to be an admin.
drop policy if exists profiles_manager_read on profiles;
create policy profiles_manager_read on profiles
  for select to authenticated
  using (current_user_can_manage_users());


-- ===========================================================
-- 4. The change log
-- ===========================================================
-- A page that can reset anybody's password and keeps no record of it is a
-- liability. If something goes wrong, "who did this and when" needs an answer
-- that is not guesswork.
create table if not exists admin_audit (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor_id     uuid,
  actor_name   text,
  action       text not null,      -- password_set, access_changed, person_added, switched_off, switched_on
  target_id    uuid,
  target_name  text,
  detail       text                -- never the password itself, only what changed
);

create index if not exists admin_audit_at_idx on admin_audit (at desc);

alter table admin_audit enable row level security;

-- Only the user administrator may read or write it. The Edge Function writes
-- with the secret key, which bypasses row-level security entirely, so a
-- password reset is logged even though no browser policy allows it.
drop policy if exists audit_manager_read on admin_audit;
create policy audit_manager_read on admin_audit
  for select to authenticated
  using (current_user_can_manage_users());

drop policy if exists audit_manager_insert on admin_audit;
create policy audit_manager_insert on admin_audit
  for insert to authenticated
  with check (current_user_can_manage_users());


-- ===========================================================
-- CHECK — this must show FOUR rows. If it says "no rows
-- returned", the paste was cut short; run this block again
-- on its own.
-- ===========================================================
select 'new columns on profiles (expect app_access, active)' as item,
       (select string_agg(column_name, ', ' order by column_name)
          from information_schema.columns
         where table_name = 'profiles'
           and column_name in ('app_access','active')) as value
union all
select 'nobody has been locked out (expect 11 active, 0 restricted)',
       (select count(*) filter (where active)::text || ' active, '
             || count(*) filter (where app_access is not null)::text || ' restricted'
          from profiles)
union all
select 'the change log exists',
       case when exists (select 1 from information_schema.tables
                          where table_name = 'admin_audit')
            then 'yes' else 'NO - tell Claude' end
union all
select 'policies letting the administrator edit people (expect 2)',
       (select count(*)::text from pg_policies
         where tablename = 'profiles'
           and policyname in ('profiles_manager_update','profiles_manager_read'));
