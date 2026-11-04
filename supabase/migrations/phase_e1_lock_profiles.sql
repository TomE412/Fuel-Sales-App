-- phase_e1_lock_profiles.sql
--
-- URGENT. Run this one on its own, before anything else.
--
-- WHAT IS WRONG
-- Any signed-in user can currently change their own role. Verified 4 Nov 2026
-- from a real rep login (test-rep): the update was allowed through to the
-- check constraint, and only the constraint's list of valid role names
-- stopped it. 'admin' IS on that list. So this, typed into the browser
-- console on a rep's phone, would have worked:
--
--     sb.from('profiles').update({role:'admin'}).eq('id', myOwnId)
--
-- An admin reads every sale, every cost price and every customer in the
-- business. Nobody has done this - there is no sign of it in the data - but
-- the door has been open since the profiles table was created.
--
-- WHY A TRIGGER AND NOT A POLICY CHANGE
-- The obvious fix is to rewrite the row-level security policy, but the
-- existing policies cannot be seen from outside the SQL editor, and if one of
-- them turns out to be a `for all` policy, dropping it would take READ access
-- away with it and lock everybody out of the apps at once. A trigger cannot
-- do that. The worst a mistake here can do is refuse a change that should
-- have been allowed, which is visible and harmless. Signing in keeps working
-- either way, because nothing in any of the five apps writes to profiles -
-- every reference in all of them is a read.


-- ===========================================================
-- 1. Who is allowed to manage people
-- ===========================================================
-- Deliberately NOT the same thing as being an admin. There are three
-- administrators (Tom, Niel, Mack) and all three can see everything, but only
-- the person holding this flag can change what anyone else is allowed to do.
alter table profiles
  add column if not exists can_manage_users boolean not null default false;

update profiles
   set can_manage_users = true
 where id = 'a9dce33f-af8c-471e-8a78-22a19a38fc5e';   -- Tom Eager

-- The throwaway test login, so the browser tests can exercise the People page
-- without Tom's own credentials being in a test file.
update profiles
   set can_manage_users = true
 where full_name = 'test-admin';


-- ===========================================================
-- 2. The guard
-- ===========================================================
create or replace function profiles_guard()
returns trigger
language plpgsql
security definer                 -- reads profiles without RLS getting in the way
set search_path = public
as $$
begin
  -- No JWT at all means the Supabase SQL editor, or an Edge Function holding
  -- the secret key. Both are already full-trust paths: reaching either one
  -- needs credentials that no app, phone or browser has. Without this, the
  -- first mistake would lock everyone including Tom out of fixing it.
  if auth.uid() is null then
    return new;
  end if;

  if coalesce((select p.can_manage_users
                 from profiles p
                where p.id = auth.uid()), false) then
    return new;
  end if;

  raise exception
    'Only a user administrator can change who someone is or what they can reach.'
    using errcode = '42501';
end $$;

-- UPDATE only, on purpose. An INSERT is not the hole: a person already has a
-- row, the primary key stops them making a second, and the insert policy stops
-- them making one for somebody else. Guarding INSERT as well would risk
-- breaking whatever creates a profile when a brand-new login is made, which
-- cannot be inspected from here.
drop trigger if exists profiles_guard_trg on profiles;
create trigger profiles_guard_trg
  before update on profiles
  for each row execute function profiles_guard();


-- ===========================================================
-- CHECK — read this before you close the tab
-- ===========================================================
select 'the guard is installed' as item,
       case when exists (select 1 from pg_trigger
                          where tgname = 'profiles_guard_trg'
                            and not tgisinternal)
            then 'yes' else 'NO - something went wrong' end as value
union all
select 'people who can manage users (expect 2: Tom and test-admin)',
       (select count(*)::text from profiles where can_manage_users)
union all
select 'who they are',
       (select string_agg(full_name, ', ' order by full_name)
          from profiles where can_manage_users)
union all
select 'everybody else (expect 9, all still able to sign in)',
       (select count(*)::text from profiles where not can_manage_users);
