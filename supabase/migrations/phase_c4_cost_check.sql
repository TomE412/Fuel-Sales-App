-- phase_c4_cost_check.sql
--
-- Lets the accounts team record that a below-cost sale has been looked at.
--
-- Two columns, nothing else. Deliberately NOT a boolean: who checked it and
-- when are the whole point - a bare "dismissed" flag would hide the alarm
-- without leaving any evidence that a person actually reviewed it, which is
-- the opposite of what this alarm is for.
--
-- Marking a sale checked does NOT change its price or hide that it was below
-- cost. The row keeps showing the cost and the sale price; it simply stops
-- counting towards the unchecked alarm.
--
-- RUN PART 1 FIRST, read it, THEN PART 2. Both safe to re-run.

-- ===========================================================
-- PART 1 - LOOK ONLY.
-- How many sales would the alarm flag right now, and do the columns exist?
-- ===========================================================

select 'cost_check_at column exists?' as question,
       case when exists (select 1 from information_schema.columns
                         where table_schema='public' and table_name='sales'
                           and column_name='cost_check_at')
            then 'yes - already added' else 'no - Part 2 will add it' end as answer
union all
select 'sales currently below cost',
       count(*)::text
  from sales
 where status <> 'cancelled' and price_tba = false
   and cost_price is not null and cost_price > 0
   and price_per_litre > 0 and price_per_litre < cost_price
union all
select 'margin at risk on those (USD)',
       coalesce(round(sum((cost_price - price_per_litre) * litres)), 0)::text
  from sales
 where status <> 'cancelled' and price_tba = false
   and cost_price is not null and cost_price > 0
   and price_per_litre > 0 and price_per_litre < cost_price;


-- ===========================================================
-- PART 2 - ADD THE COLUMNS.
-- ===========================================================

alter table sales add column if not exists cost_check_at timestamptz;
alter table sales add column if not exists cost_check_by text;

-- Only the flagged rows are ever read by name, and there are very few of
-- them, so a partial index keeps this off the main table's write path.
create index if not exists sales_cost_check_idx
  on sales (cost_check_at)
  where cost_check_at is not null;

-- CHECK - must return both columns.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'sales'
  and column_name in ('cost_check_at', 'cost_check_by')
order by column_name;
