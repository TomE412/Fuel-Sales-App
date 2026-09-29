-- customer_assignment_pull.sql
--
-- READ ONLY. Changes nothing.
--
-- Everything needed to assign a rep to every customer, one row each.
--
-- The point of the extra columns is that this should be a REVIEW, not 200
-- blank boxes: "suggested_rep" is whoever has actually logged the most litres
-- to that customer, and "rep_breakdown" shows the working so a suggestion can
-- be overruled on sight. A customer with no app sales has no suggestion -
-- those are the ones that need a real decision.
--
-- Section 2 at the bottom is separate and matters: customers that appear on
-- sales but have no row in customer_locations at all. They cannot be assigned
-- until they exist in the canonical list, so they need adding first.

with sale_rep as (
  -- app sales resolved to the canonical customer, the same way
  -- all_customer_orders does it: match the typed name against invoice_name
  -- first, then against the app_name alias.
  select cl.id                                            as cust_id,
         coalesce(nullif(btrim(s.rep_name), ''), '(none)') as rep,
         count(*)                                         as n_orders,
         sum(s.litres)                                    as litres
  from sales s
  join customer_locations cl
    on lower(btrim(cl.invoice_name)) = lower(btrim(s.customer))
    or lower(btrim(coalesce(cl.app_name, ''))) = lower(btrim(s.customer))
  where s.status <> 'cancelled'
  group by cl.id, 2
),
top_rep as (
  select distinct on (cust_id) cust_id, rep, litres
  from sale_rep order by cust_id, litres desc, n_orders desc
),
breakdown as (
  select cust_id,
         string_agg(rep || ' ' || n_orders || ' ord / ' || round(litres) || ' L',
                    '; ' order by litres desc) as rep_breakdown,
         sum(litres) as app_litres,
         count(*)    as rep_count
  from sale_rep group by cust_id
),
hist as (
  -- whole trading history, invoices included, keyed on the canonical name
  select lower(btrim(o.customer_canon)) as k,
         count(*)        as all_orders,
         sum(o.litres)   as all_litres,
         min(o.order_date) as first_order,
         max(o.order_date) as last_order
  from all_customer_orders o
  where o.order_date is not null
  group by 1
)
select
  cl.id,
  cl.invoice_name                                   as customer,
  coalesce(cl.app_name, '')                         as alias_reps_type,
  coalesce(cl.town, '')                             as town,
  coalesce(nullif(btrim(cl.assigned_rep), ''), '')  as current_rep,
  coalesce(tr.rep, '')                              as suggested_rep,
  case
    when cl.assigned_rep is not null and btrim(cl.assigned_rep) <> '' then 'already assigned'
    when tr.rep is null then 'NO APP SALES - decide manually'
    when b.rep_count > 1 then 'several reps sell here - check'
    else 'clear suggestion'
  end                                               as action,
  coalesce(b.rep_breakdown, '')                     as rep_breakdown,
  coalesce(h.all_orders, 0)                         as orders_all_time,
  round(coalesce(h.all_litres, 0))                  as litres_all_time,
  h.first_order,
  h.last_order,
  case when h.last_order is null then null
       else (current_date - h.last_order) end       as days_since_last
from customer_locations cl
left join top_rep   tr on tr.cust_id = cl.id
left join breakdown b  on b.cust_id  = cl.id
left join hist      h  on h.k = lower(btrim(cl.invoice_name))
order by coalesce(h.all_litres, 0) desc nulls last, cl.invoice_name;


-- ===========================================================
-- SECTION 2 - run this SEPARATELY.
-- Names that appear on sales but are not in the canonical customer list, so
-- they cannot be assigned to anyone until they are added to it.
-- ===========================================================
--
-- select btrim(s.customer) as unlisted_name,
--        count(*) as orders, round(sum(s.litres)) as litres,
--        min(s.sale_date) as first_seen, max(s.sale_date) as last_seen,
--        string_agg(distinct coalesce(nullif(btrim(s.rep_name),''),'(none)'), ', ') as sold_by
-- from sales s
-- where s.status <> 'cancelled'
--   and not exists (
--     select 1 from customer_locations cl
--     where lower(btrim(cl.invoice_name)) = lower(btrim(s.customer))
--        or lower(btrim(coalesce(cl.app_name,''))) = lower(btrim(s.customer)))
-- group by 1
-- order by litres desc;
