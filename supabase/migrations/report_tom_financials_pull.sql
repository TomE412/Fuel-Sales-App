-- report_tom_financials_pull.sql
-- READ ONLY.
--
-- The money side of Tom's record. Revenue exists only from 22 Jun 2026, when
-- the app went live - invoice_history carries litres and dates but no prices,
-- so the first five months of the year have no financial figure at all and
-- none is invented here.
--
-- Margin covers only orders where a cost price was entered, and the capture
-- rate is reported beside it so the figure is never read as whole-book.

with tom as (select array['Tom Eager','Tom Eager CW'] as accts),
mine as (
  select s.*, to_char(date_trunc('month', s.sale_date), 'YYYY-MM') as ym
  from sales s, tom
  where s.status <> 'cancelled' and btrim(s.rep_name) = any(tom.accts)
)
select 'A_revenue' as section, ym as k1, 'revenue_usd' as metric,
       round(sum(case when price_tba then 0 else litres * price_per_litre end))::text as value
from mine group by ym
union all
select 'A_revenue', ym, 'litres', round(sum(litres))::text from mine group by ym

union all
select 'B_margin', 'all', 'orders_total',  count(*)::text from mine
union all
select 'B_margin', 'all', 'orders_costed', count(*) filter (where cost_price is not null and not price_tba)::text from mine
union all
select 'B_margin', 'all', 'litres_costed',
       round(sum(litres) filter (where cost_price is not null and not price_tba))::text from mine
union all
select 'B_margin', 'all', 'revenue_on_costed',
       round(sum(litres * price_per_litre) filter (where cost_price is not null and not price_tba))::text from mine
union all
select 'B_margin', 'all', 'gross_margin_usd',
       round(sum((price_per_litre - cost_price) * litres) filter (where cost_price is not null and not price_tba))::text from mine

union all
select 'C_collection', 'paid',   'revenue_usd',
       round(sum(case when price_tba then 0 else litres*price_per_litre end) filter (where paid))::text from mine
union all
select 'C_collection', 'unpaid', 'revenue_usd',
       round(sum(case when price_tba then 0 else litres*price_per_litre end) filter (where not paid))::text from mine
union all
select 'C_collection', 'tba',    'orders', count(*) filter (where price_tba)::text from mine

union all
select 'D_company', 'all', 'revenue_usd',
       round(sum(case when price_tba then 0 else litres*price_per_litre end))::text
from sales where status <> 'cancelled'
union all
select 'D_company', 'all', 'gross_margin_usd',
       round(sum((price_per_litre - cost_price) * litres) filter (where cost_price is not null and not price_tba))::text
from sales where status <> 'cancelled'
order by section, k1, metric;
