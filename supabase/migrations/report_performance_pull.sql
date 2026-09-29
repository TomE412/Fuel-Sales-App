-- report_performance_pull.sql
--
-- READ ONLY. Changes nothing. Safe to run any time.
--
-- Pulls the numbers behind a personal performance report in one long-format
-- table, so a single "Download CSV" carries everything.
--
-- Two sources, and the difference matters when quoting these in a meeting:
--   'invoice' — invoice_history, the longer record, but it carries NO rep
--               name. Nothing in it can be attributed to a person directly.
--   'app'     — sales logged in the app, which DO carry a rep name.
-- So anything below keyed by assigned_rep is "customers currently assigned
-- to that rep", not "sales that rep personally made" — an honest framing for
-- the invoice era, and worth saying out loud rather than blurring.

with orders as (
  select customer_canon, order_date, litres, source,
         to_char(date_trunc('month', order_date), 'YYYY-MM') as ym
  from all_customer_orders
  where order_date is not null
),
assigned as (
  select lower(btrim(invoice_name)) as k,
         coalesce(nullif(btrim(assigned_rep), ''), '(unassigned)') as rep
  from customer_locations
),
first_order as (
  select customer_canon,
         to_char(date_trunc('month', min(order_date)), 'YYYY-MM') as first_ym
  from orders group by 1
),
per_customer as (
  select customer_canon, count(*) as orders, sum(litres) as litres,
         min(order_date) as first_o, max(order_date) as last_o
  from orders group by 1
)

-- A. What range of data actually exists
select 'A_coverage' as section, source as k1, '' as k2,
       'first_order' as metric, min(order_date)::text as value from orders group by source
union all
select 'A_coverage', source, '', 'last_order', max(order_date)::text from orders group by source
union all
select 'A_coverage', source, '', 'orders', count(*)::text from orders group by source
union all
select 'A_coverage', source, '', 'litres', round(sum(litres))::text from orders group by source

-- B. Volume and customers per month, whole company, split by source
union all
select 'B_monthly', ym, source, 'orders', count(*)::text from orders group by ym, source
union all
select 'B_monthly', ym, source, 'litres', round(sum(litres))::text from orders group by ym, source
union all
select 'B_monthly', ym, source, 'customers', count(distinct customer_canon)::text from orders group by ym, source

-- C. Same, but per assigned rep (all sources) — the "my customers" view
union all
select 'C_by_rep_month', o.ym, coalesce(a.rep, '(unassigned)'), 'litres', round(sum(o.litres))::text
from orders o left join assigned a on a.k = lower(btrim(o.customer_canon))
group by o.ym, coalesce(a.rep, '(unassigned)')
union all
select 'C_by_rep_month', o.ym, coalesce(a.rep, '(unassigned)'), 'customers', count(distinct o.customer_canon)::text
from orders o left join assigned a on a.k = lower(btrim(o.customer_canon))
group by o.ym, coalesce(a.rep, '(unassigned)')

-- D. New customers each month (their first ever order, either source)
union all
select 'D_new_customers', first_ym, '', 'new_customers', count(*)::text
from first_order group by first_ym

-- E. App-logged sales by the rep who actually recorded them
union all
select 'E_app_by_rep', coalesce(nullif(btrim(rep_name), ''), '(none)'), '', 'orders', count(*)::text
from sales where status <> 'cancelled' group by 2
union all
select 'E_app_by_rep', coalesce(nullif(btrim(rep_name), ''), '(none)'), '', 'litres', round(sum(litres))::text
from sales where status <> 'cancelled' group by 2
union all
select 'E_app_by_rep', coalesce(nullif(btrim(rep_name), ''), '(none)'), '', 'customers', count(distinct customer)::text
from sales where status <> 'cancelled' group by 2
union all
select 'E_app_by_rep', coalesce(nullif(btrim(rep_name), ''), '(none)'), '', 'revenue_usd',
       round(sum(case when price_tba then 0 else litres * price_per_litre end))::text
from sales where status <> 'cancelled' group by 2

-- F. Retention: how many customers came back, and how often
union all
select 'F_retention', case when orders = 1 then '1 order only'
                           when orders between 2 and 4 then '2-4 orders'
                           when orders between 5 and 9 then '5-9 orders'
                           else '10+ orders' end, '',
       'customers', count(*)::text
from per_customer group by 1, 2
union all
select 'F_retention', 'all', '', 'customers_total', count(*)::text from per_customer
union all
select 'F_retention', 'all', '', 'customers_repeat', count(*) filter (where orders > 1)::text from per_customer
union all
select 'F_retention', 'all', '', 'still_active_90d',
       count(*) filter (where last_o >= current_date - 90)::text from per_customer

order by section, k1, k2, metric;
