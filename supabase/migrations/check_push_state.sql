-- check_push_state.sql — why is a phone not buzzing?
--
-- Read-only. Run in the Supabase SQL Editor, which runs as the owner and so
-- can see every row regardless of row-level security.
--
-- This splits the problem cleanly in two. Everything up to and including the
-- push service accepting the message is recorded here. Anything after that is
-- the phone's own business and no row will ever show it.


-- ===========================================================
-- 1. Is the phone signed up at all, and what happened to it?
-- ===========================================================
select pr.full_name,
       p.device_label,
       -- which push service the phone was handed to
       case
         when p.endpoint like '%fcm.googleapis.com%'      then 'Google (Android/Chrome)'
         when p.endpoint like '%web.push.apple.com%'       then 'Apple (iPhone)'
         when p.endpoint like '%notify.windows.com%'       then 'Microsoft'
         when p.endpoint like '%mozilla%'                  then 'Mozilla (Firefox)'
         else 'other: ' || split_part(p.endpoint, '/', 3)
       end                                     as push_service,
       p.created_at                            as turned_on,
       p.last_sent_at,
       p.expired_at,
       p.last_error,
       -- the one-line verdict
       case
         when p.expired_at is not null
           then 'DEAD - this phone must turn notifications on again'
         when p.last_error is not null
           then 'THE SEND FAILED - see last_error, the problem is this end'
         when p.last_sent_at is not null
           then 'SENT OK - the message left Skelsee and '
                || case when p.endpoint like '%apple.com%' then 'Apple' else 'Google' end
                || ' accepted it, so anything wrong now is on the phone itself'
         else 'NEVER SENT TO - the function has not successfully run for this phone'
       end                                     as verdict
from push_subscriptions p
join profiles pr on pr.id = p.user_id
order by pr.full_name, p.created_at desc;


-- ===========================================================
-- 2. If the list above is EMPTY, "Turn on notifications" never
--    saved. Check the table and policies are really there.
-- ===========================================================
select 'rows in push_subscriptions' as item,
       (select count(*)::text from push_subscriptions) as value
union all
select 'policies on it (expect 4)',
       (select count(*)::text from pg_policies where tablename = 'push_subscriptions')
union all
select 'row level security on',
       case when (select relrowsecurity from pg_class where relname = 'push_subscriptions')
            then 'yes' else 'NO - that is wrong' end;
