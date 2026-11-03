-- phase_d7_push_subscriptions.sql
--
-- Where a phone's "you may send me notifications" permission is kept, so a
-- rep can be told about their load while the app is shut.
--
-- How web push actually works, because the shape of this table only makes
-- sense alongside it:
--
--   1. The rep taps "Turn on notifications". The phone asks them, and if
--      they agree the BROWSER MAKER (Google for Android and Chrome, Apple
--      for iPhone) hands back a subscription: a long URL to post to, plus
--      two keys used to encrypt the message so only that phone can read it.
--   2. Those three things are stored here, against that rep.
--   3. When the office sends a load on its way, an Edge Function looks up
--      every subscription belonging to that load's rep and posts the
--      message to each URL. Google or Apple then wakes the phone.
--
--   Skelsee never sends anything to a phone directly, and cannot read a
--   notification after it is encrypted. The endpoint is not a secret in the
--   usual sense but it IS a capability - anyone holding it can ping that
--   phone - which is why reps cannot read each other's rows.
--
-- ONE ROW PER PHONE, not one per rep. A rep with a phone and a tablet gets
-- told on both, and the unique key is the endpoint rather than the rep.
--
-- RUN PART 1 FIRST, read it, THEN PART 2. Both are safe to re-run.


-- ===========================================================
-- PART 1 - LOOK ONLY.
-- ===========================================================

select 'push_subscriptions table' as item,
       case when to_regclass('public.push_subscriptions') is null
            then 'MISSING - Part 2 creates it'
            else 'exists, ' || (select count(*) from push_subscriptions)::text || ' phones'
       end as state
union all
select 'current_user_role() helper',
       case when exists (select 1 from pg_proc where proname = 'current_user_role')
            then 'exists' else 'MISSING - the policies below need it, STOP' end
union all
select 'reps and admins who could turn it on',
       (select count(*) from profiles where role in ('rep','admin'))::text;


-- ===========================================================
-- PART 2 - BUILD.
-- ===========================================================

create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,

  -- The URL the push service gave us for this phone. Unique: the same phone
  -- re-subscribing must update its row rather than collect duplicates and
  -- get told three times.
  endpoint     text not null unique,

  -- The two keys the message is encrypted with, as the browser gave them.
  p256dh       text not null,
  auth         text not null,

  -- Which phone this is, so a rep can tell their own two apart and so a
  -- support question ("it works on my tablet but not my phone") is
  -- answerable at all.
  device_label text,

  created_at   timestamptz not null default now(),
  last_sent_at timestamptz,

  -- A subscription dies when the app is deleted or the browser rotates it.
  -- The push service answers 404 or 410 and the sender stamps that here
  -- rather than deleting at once, so "the rep says they get nothing" has
  -- something to look at.
  expired_at   timestamptz,
  last_error   text
);

create index if not exists push_subs_user_idx on push_subscriptions (user_id)
  where expired_at is null;


-- --- who can see and change what ------------------------------------------
alter table push_subscriptions enable row level security;

-- A rep manages their OWN phones and sees nobody else's. Split into four
-- policies rather than one `for all`, because the write ones need
-- with check and the read one must not be wider than it has to be.
drop policy if exists push_own_read on push_subscriptions;
create policy push_own_read on push_subscriptions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists push_own_insert on push_subscriptions;
create policy push_own_insert on push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists push_own_update on push_subscriptions;
create policy push_own_update on push_subscriptions for update to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists push_own_delete on push_subscriptions;
create policy push_own_delete on push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

-- NOTE on the sender: the Edge Function that actually posts the messages
-- runs with the service role key, which bypasses row-level security
-- entirely. That is deliberate and unavoidable - it has to read the
-- SUBSCRIBER's row while being called by somebody else (the office) - and it
-- is why that function must check for itself that its caller is ops or admin
-- before it will send anything. The check lives in the function, not here.
--
-- Admins are given no read policy on other people's rows on purpose. Nobody
-- needs to look at these, and an endpoint is a capability to ping a phone.


-- ===========================================================
-- PART 3 - CHECK. Expect the table present, 4 policies, and 0
-- phones (nobody can subscribe until the app files are pushed).
-- ===========================================================

select 'table' as item,
       case when to_regclass('public.push_subscriptions') is null then 'FAILED' else 'OK' end as state
union all
select 'row level security on',
       case when (select relrowsecurity from pg_class where relname = 'push_subscriptions')
            then 'OK' else 'FAILED' end
union all
select 'policies (expect 4)',
       (select count(*)::text from pg_policies where tablename = 'push_subscriptions')
union all
select 'phones subscribed',
       (select count(*)::text from push_subscriptions)
order by item;
