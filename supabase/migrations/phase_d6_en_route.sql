-- phase_d6_en_route.sql
--
-- "Truck en route" — the middle stage of a delivery, so a rep can see that
-- their load has actually left the yard rather than only that a truck was
-- booked for it.
--
-- THE WHOLE DATABASE CHANGE IS TWO COLUMNS. There is deliberately no
-- notifications table, because the three things a rep gets told are already
-- facts with times on them:
--
--     truck assigned  ->  delivery_assignment.assigned_at   (already exists)
--     on its way      ->  delivery_assignment.en_route_at   (added here)
--     delivered       ->  sales.delivered_at                (already exists)
--
-- The rep app builds its notification list from those three timestamps. That
-- matters for three reasons:
--
--   * A notifications table can drift from reality. If the row failed to
--     write, the rep is never told. Here the notification IS the fact.
--
--   * The rep app already caches delivery_assignment and sales to the phone,
--     so the list works with no signal and needs no extra plumbing.
--
--   * Undo works for free. When the office taps "Not delivered",
--     delivered_at goes back to null and the notification retracts itself.
--     A notifications table would leave a false "delivered" in the rep's
--     list for ever.
--
-- RUN PART 1 FIRST, read it, THEN PART 2. Both are safe to re-run.


-- ===========================================================
-- PART 1 - LOOK ONLY. What is already here?
-- ===========================================================

select 'delivery_assignment table' as item,
       case when to_regclass('public.delivery_assignment') is null
            then 'MISSING - phase_d1 never ran, STOP and run that first'
            else 'exists, ' || (select count(*) from delivery_assignment)::text || ' assignments'
       end as state
union all
select 'en_route_at column',
       case when exists (select 1 from information_schema.columns
                         where table_schema = 'public'
                           and table_name  = 'delivery_assignment'
                           and column_name = 'en_route_at')
            then 'already exists - Part 2 will change nothing'
            else 'MISSING - Part 2 adds it' end
union all
select 'sales.delivered_at column',
       case when exists (select 1 from information_schema.columns
                         where table_schema = 'public'
                           and table_name  = 'sales'
                           and column_name = 'delivered_at')
            then 'exists' else 'MISSING - something is badly wrong, STOP' end
union all
select 'loads already marked delivered',
       (select count(*) from sales where delivered_at is not null)::text;


-- ===========================================================
-- PART 2 - ADD THE TWO COLUMNS.
-- ===========================================================

-- Nullable with NO default, on purpose. A load that has never been sent on
-- its way must read as "not asked yet", not as a false "no". Every existing
-- assignment stays null and tells the rep nothing, which is correct — we do
-- not know when any of them left.
alter table delivery_assignment add column if not exists en_route_at timestamptz;

-- Who pressed the button. Same shape as assigned_by, which is plain text
-- rather than a user id because it is shown to the rep, not joined on.
alter table delivery_assignment add column if not exists en_route_by text;

comment on column delivery_assignment.en_route_at is
  'When the office said this load had left. Null = not sent yet. Cleared if the rig is re-assigned, because a load is not on its way with a truck it no longer has.';
comment on column delivery_assignment.en_route_by is
  'Name of whoever pressed "En route", shown to the rep.';


-- --- who can write it ------------------------------------------------------
-- Nothing to do: the existing da_write policy from phase_d1 already covers
-- every write to this table for ops / accounts / admin, and these two
-- columns are part of the same row.
--
-- NOTE, not a change: phase_d1 also left da_rep_seen as
-- `for update using (true) with check (true)` so a rep could stamp
-- seen_by_rep_at. That policy is wider than it needs to be and technically
-- lets a rep write en_route_at too. Tightening it means column-level grants
-- and risks breaking the seen stamp that reps rely on daily, so it is left
-- alone and written down here instead. Reps have no button for it.


-- ===========================================================
-- PART 3 - CHECK. Expect both columns present and 0 loads en
-- route (nothing has been sent yet — the button does not exist
-- until the app files are pushed).
-- ===========================================================

select 'en_route_at column' as item,
       case when exists (select 1 from information_schema.columns
                         where table_schema = 'public'
                           and table_name  = 'delivery_assignment'
                           and column_name = 'en_route_at')
            then 'OK' else 'FAILED' end as state
union all
select 'en_route_by column',
       case when exists (select 1 from information_schema.columns
                         where table_schema = 'public'
                           and table_name  = 'delivery_assignment'
                           and column_name = 'en_route_by')
            then 'OK' else 'FAILED' end
union all
select 'assignments on the board', (select count(*) from delivery_assignment)::text
union all
select 'loads marked en route',    (select count(*) from delivery_assignment where en_route_at is not null)::text
order by item;
