-- phase_c1_delivery_plan.sql
--
-- The Logistics > Dash planning board. One row per sale that has been put on
-- a truck. A sale with no row here is unplanned and sits in the "To plan"
-- tray. Shared by everyone, so two people planning at once see the same board.
--
-- Deliberately NOT a copy of the sale: it holds only the assignment, and
-- points at sales(id). The sale stays the single source of truth for who,
-- where, how much — so a rep editing litres does not leave a stale figure
-- sitting on the planning board.
--
-- RUN PART 1 FIRST, read the result, THEN run PART 2.
-- The Supabase SQL editor only shows the output of the last statement, which
-- is why they are separate. Both parts are safe to re-run.


-- ===========================================================
-- PART 1 — LOOK ONLY. Changes nothing.
-- ===========================================================

select 'delivery_plan already exists?' as question,
       case when exists (select 1 from information_schema.tables
                         where table_schema='public' and table_name='delivery_plan')
            then 'YES - stop, tell Tom' else 'no - safe to continue' end as answer
union all
select 'active trucks to make lanes for',
       count(*)::text from trucks where active = true
union all
select 'sales that would show in To plan',
       count(*)::text from sales
       where status <> 'delivered' and status <> 'cancelled';


-- ===========================================================
-- PART 2 — CREATE THE TABLE. Run after Part 1 looks right.
-- ===========================================================

create table if not exists delivery_plan (
  sale_id    bigint primary key references sales(id) on delete cascade,
  truck_key  text   not null references trucks(truck_key) on delete cascade,
  position   integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);

create index if not exists delivery_plan_truck_idx on delivery_plan (truck_key, position);

alter table delivery_plan enable row level security;

-- Everyone signed in can SEE the plan — reps benefit from knowing their
-- order is on a truck, and it is not sensitive.
drop policy if exists delivery_plan_read on delivery_plan;
create policy delivery_plan_read on delivery_plan
  for select to authenticated using (true);

-- Only the people who actually plan can CHANGE it. Note this is one policy
-- for all writes: the board needs insert, update AND delete (dragging an
-- order back to the tray deletes its row), and a read-only policy set is
-- exactly the trap that made lost_sales silently un-editable.
drop policy if exists delivery_plan_write on delivery_plan;
create policy delivery_plan_write on delivery_plan
  for all to authenticated
  using      (current_user_role() = any (array['ops','accounts','admin']))
  with check (current_user_role() = any (array['ops','accounts','admin']));

-- CHECK — must return 4 rows: the table, its index, and both policies.
select 'table'  as kind, table_name as name from information_schema.tables
  where table_schema='public' and table_name='delivery_plan'
union all
select 'index',  indexname  from pg_indexes
  where schemaname='public' and tablename='delivery_plan'
union all
select 'policy', policyname from pg_policies
  where schemaname='public' and tablename='delivery_plan'
order by kind, name;
