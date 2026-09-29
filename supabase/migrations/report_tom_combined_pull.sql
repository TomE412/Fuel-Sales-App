-- report_tom_combined_pull.sql
--
-- STEP 1 writes (four assignments). STEP 2 onward only reads.
--
-- Pulls a performance report for Tom Eager treating both rep accounts
-- ("Tom Eager" and "Tom Eager CW") as one person, which is what they are.
--
-- Run the whole thing; only the last statement prints.

-- ===========================================================
-- STEP 1 - the last four assignments, Tom's call 29 Sep 2026
-- ===========================================================
update customer_locations
set assigned_rep = 'Niel Martin', assigned_at = now(),
    assigned_by = 'manual - Tom, 29 Sep 2026'
where id in (18, 23, 83, 73);   -- CASH SALES, Cash Sales Bulk, J K Motors, Grandeur Mining


-- ===========================================================
-- STEP 2 - the report data, long format
-- ===========================================================
with tom as (select array['Tom Eager','Tom Eager CW'] as accts),
logged as (
  select to_char(date_trunc('month', s.sale_date), 'YYYY-MM') as ym,
         btrim(s.rep_name) as rep, s.litres, s.customer, s.cost_price, s.price_tba,
         case when s.price_tba then 0 else s.litres * s.price_per_litre end as revenue
  from sales s where s.status <> 'cancelled'
),
book as (
  select to_char(date_trunc('month', o.order_date), 'YYYY-MM') as ym,
         btrim(coalesce(cl.assigned_rep,'')) as rep, o.litres, o.customer_canon
  from all_customer_orders o
  left join customer_locations cl
    on lower(btrim(cl.invoice_name)) = lower(btrim(o.customer_canon))
  where o.order_date is not null
),
tomcust as (
  select lower(btrim(customer)) as cust, count(*) as orders, sum(litres) as litres
  from logged, tom where rep = any(tom.accts) group by 1
)

-- A. Tom combined, month by month, sales he logged
select 'A_tom_logged' as section, ym as k1, '' as k2, 'litres' as metric, round(sum(litres))::text as value
from logged, tom where rep = any(tom.accts) group by ym
union all
select 'A_tom_logged', ym, '', 'orders', count(*)::text
from logged, tom where rep = any(tom.accts) group by ym
union all
select 'A_tom_logged', ym, '', 'revenue', round(sum(revenue))::text
from logged, tom where rep = any(tom.accts) group by ym
union all
select 'A_tom_logged', ym, '', 'customers', count(distinct lower(btrim(customer)))::text
from logged, tom where rep = any(tom.accts) group by ym

-- B. Tom combined, month by month, volume through his book (now fully assigned)
union all
select 'B_tom_book', ym, '', 'litres', round(sum(litres))::text
from book, tom where rep = any(tom.accts) group by ym

-- C. Company monthly, for share
union all
select 'C_company_logged', ym, '', 'litres', round(sum(litres))::text from logged group by ym

-- D. Every rep's total, for standings
union all
select 'D_rep_totals', rep, '', 'litres', round(sum(litres))::text from logged group by rep
union all
select 'D_rep_totals', rep, '', 'orders', count(*)::text from logged group by rep

-- E. Tom's biggest customers
union all
select 'E_top_customers', cust, '', 'litres', round(litres)::text from tomcust
where litres >= 40000

-- F. Tom's repeat business and cost-price capture
union all
select 'F_tom', 'customers', '', 'count', count(*)::text from tomcust
union all
select 'F_tom', 'repeat_customers', '', 'count', count(*) filter (where orders > 1)::text from tomcust
union all
select 'F_tom', 'orders_costed', '', 'count',
       count(*) filter (where cost_price is not null and not price_tba)::text
from logged, tom where rep = any(tom.accts)
union all
select 'F_tom', 'orders_total', '', 'count', count(*)::text
from logged, tom where rep = any(tom.accts)
union all
select 'F_tom', 'margin_on_costed', '', 'usd',
       round(sum((price_per_litre_x - cost_price) * litres))::text
from (select l.litres, l.cost_price,
             (case when l.price_tba then 0 else l.revenue / nullif(l.litres,0) end) as price_per_litre_x
      from logged l, tom t
      where l.rep = any(t.accts) and l.cost_price is not null and not l.price_tba) z

order by section, k1, k2, metric;
