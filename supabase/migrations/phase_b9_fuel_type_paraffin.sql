-- phase_b9_fuel_type_paraffin.sql
--
-- WHY: the rep app has offered a Paraffin button since commit 85f580c
-- (20 Aug 2026), but that commit changed index.html only — no SQL ran with
-- it. sales_fuel_type_check was never widened, so every paraffin sale was
-- rejected by the database. Confirmed 28 Sep 2026: the live rule read
--   CHECK (fuel_type = ANY (ARRAY['Diesel', 'Petrol']))
-- and the sales table held 516 Diesel, 43 Petrol, 18 blank, zero Paraffin —
-- while invoice_history held 17 real paraffin sales, so the product is
-- genuine and only the app was blocked from recording it.
--
-- It surfaced only now because paraffin is rare, and it surfaced loudly
-- because the sale was logged offline: a queued sale the server rejects is
-- kept and retried on every sync, so the rep saw the error again and again.
--
-- RUN PART 1 FIRST, read the result, THEN run PART 2. They are separate
-- because the Supabase SQL editor only displays the output of the last
-- statement in whatever you paste. Both parts are safe to re-run.


-- ===========================================================
-- PART 1 — LOOK ONLY. Changes nothing.
-- Folded into one query so all of it displays at once.
-- ===========================================================

select 'RULE TODAY' as section,
       pg_get_constraintdef(oid) as value,
       null::bigint as sales_count
from pg_constraint
where conrelid = 'sales'::regclass
  and conname = 'sales_fuel_type_check'

union all
select 'sales table', coalesce(fuel_type, '(blank)'), count(*)
from sales group by 2

union all
select 'invoice_history table', coalesce(fuel_type, '(blank)'), count(*)
from invoice_history group by 2

order by section, sales_count desc nulls first;

-- STOP if any fuel type appears that is not Diesel, Petrol, Paraffin or
-- (blank). Postgres validates every existing row when the new constraint is
-- added, so Part 2 would fail on those rows — look at them first.


-- ===========================================================
-- PART 2 — THE FIX. Run only after Part 1 looks as expected.
-- ===========================================================

alter table sales drop constraint if exists sales_fuel_type_check;

alter table sales add constraint sales_fuel_type_check
  check (fuel_type is null or fuel_type in ('Diesel', 'Petrol', 'Paraffin'));

-- CHECK — must list all three fuels. Being the last statement, this is what
-- the editor displays.
--
-- Do NOT try to prove this by inserting a test paraffin sale: a BEFORE
-- INSERT trigger fills rep_name from the logged-in rep, and in the SQL
-- editor there is no logged-in rep, so rep_name comes out null and the
-- insert dies on a not-null violation — taking the whole transaction, and
-- the constraint change with it. Reading the rule back proves it just as
-- well. (Learned the hard way, 28 Sep 2026.)
select pg_get_constraintdef(oid) as new_rule
from pg_constraint
where conrelid = 'sales'::regclass
  and conname = 'sales_fuel_type_check';
