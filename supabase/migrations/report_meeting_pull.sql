-- report_meeting_pull.sql
--
-- READ ONLY. Changes nothing. Safe to run any time.
--
-- Everything behind a performance-meeting report, in one long-format table.
--
-- It deliberately returns BOTH attribution bases, because they answer
-- different questions and mixing them up is how the first version of this
-- report went wrong:
--
--   LOGGED  - whose name is on the sale. Only exists from 22 Jun 2026, when
--             the app went live, but it is proof of who made the sale.
--   BOOK    - volume through customers assigned to a rep. Reaches back to
--             1 Jan 2026, but says nothing about who closed it, and misses
--             the large share of trade going to unassigned customers.
--
-- Section E reports that unassigned share directly, so the gap between the
-- two bases is visible rather than something the reader has to infer.

with logged as (
  select to_char(date_trunc('month', s.sale_date), 'YYYY-MM') as ym,
         coalesce(nullif(btrim(s.rep_name), ''), '(none)')     as rep,
         s.litres,
         case when s.price_tba then 0 else s.litres * s.price_per_litre end as revenue,
         s.customer,
         cl.assigned_rep
  from sales s
  left join customer_locations cl
    on lower(btrim(cl.invoice_name)) = lower(btrim(s.customer))
    or lower(btrim(coalesce(cl.app_name, ''))) = lower(btrim(s.customer))
  where s.status <> 'cancelled'
),
book as (
  select to_char(date_trunc('month', o.order_date), 'YYYY-MM') as ym,
         coalesce(nullif(btrim(cl.assigned_rep), ''), '(unassigned)') as rep,
         o.litres, o.customer_canon
  from all_customer_orders o
  left join customer_locations cl
    on lower(btrim(cl.invoice_name)) = lower(btrim(o.customer_canon))
  where o.order_date is not null
),
percust as (
  select coalesce(nullif(btrim(rep_name), ''), '(none)') as rep,
         lower(btrim(customer)) as cust, count(*) as orders
  from sales where status <> 'cancelled' group by 1, 2
)

-- A. LOGGED: litres, orders, revenue per rep per month
select 'A_logged' as section, ym as k1, rep as k2, 'litres' as metric, round(sum(litres))::text as value
from logged group by ym, rep
union all
select 'A_logged', ym, rep, 'orders',  count(*)::text        from logged group by ym, rep
union all
select 'A_logged', ym, rep, 'revenue', round(sum(revenue))::text from logged group by ym, rep
union all
select 'A_logged', ym, rep, 'customers', count(distinct lower(btrim(customer)))::text from logged group by ym, rep

-- B. BOOK: litres per assigned rep per month, all sources
union all
select 'B_book', ym, rep, 'litres', round(sum(litres))::text from book group by ym, rep

-- C. Company totals per month, by where the record came from
union all
select 'C_company', to_char(date_trunc('month', order_date), 'YYYY-MM'), source, 'litres',
       round(sum(litres))::text
from all_customer_orders where order_date is not null group by 2, 3

-- D. Retention per rep: customers who came back, across the whole app record
union all
select 'D_retention', rep, '', 'customers', count(*)::text from percust group by rep
union all
select 'D_retention', rep, '', 'repeat', count(*) filter (where orders > 1)::text from percust group by rep

-- E. The gap between the two bases: how much of what each rep logged went to
--    a customer nobody owns. This is why BOOK figures read low.
union all
select 'E_unassigned', ym, rep, 'litres_unassigned',
       round(sum(litres) filter (where assigned_rep is null))::text
from logged group by ym, rep

order by section, k1, k2, metric;
