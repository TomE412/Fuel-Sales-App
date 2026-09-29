-- phase_c2_assign_reps.sql
--
-- Fills customer_locations.assigned_rep from the evidence already in the
-- sales table: whoever has logged sales to that customer becomes its rep.
--
-- Scope is deliberately narrow. It ONLY touches a customer where:
--   * assigned_rep is currently empty  - it never overwrites a human decision
--   * exactly ONE rep has ever sold to them in the app - no judgement call
--   * that rep is a real name, not '(none)'
--
-- Customers sold to by several reps, and customers with no app sales at all,
-- are left alone and listed by PART 3 and PART 4 for a person to decide.
--
-- RUN THE PARTS IN ORDER, reading the output of each before the next.
-- Parts 1, 3 and 4 only look. Part 2 is the only one that writes.

-- ===========================================================
-- PART 1 - PREVIEW. Exactly what Part 2 would change. Changes nothing.
-- ===========================================================

with sale_rep as (
  select cl.id as cust_id,
         coalesce(nullif(btrim(s.rep_name), ''), '(none)') as rep,
         count(*) as n_orders, sum(s.litres) as litres
  from sales s
  join customer_locations cl
    on lower(btrim(cl.invoice_name)) = lower(btrim(s.customer))
    or lower(btrim(coalesce(cl.app_name, ''))) = lower(btrim(s.customer))
  where s.status <> 'cancelled'
  group by cl.id, 2
),
agg as (
  select cust_id, count(*) as rep_count,
         min(rep) as only_rep, sum(n_orders) as orders, sum(litres) as litres
  from sale_rep group by cust_id
)
select cl.id, cl.invoice_name as customer,
       a.only_rep as will_be_assigned_to,
       a.orders, round(a.litres) as litres
from customer_locations cl
join agg a on a.cust_id = cl.id
where (cl.assigned_rep is null or btrim(cl.assigned_rep) = '')
  and a.rep_count = 1
  and a.only_rep <> '(none)'
order by a.litres desc;


-- ===========================================================
-- PART 2 - APPLY. This writes. Run only once Part 1 looks right.
-- Safe to re-run: the WHERE clause stops matching once a row is assigned.
-- ===========================================================

with sale_rep as (
  select cl.id as cust_id,
         coalesce(nullif(btrim(s.rep_name), ''), '(none)') as rep,
         count(*) as n_orders, sum(s.litres) as litres
  from sales s
  join customer_locations cl
    on lower(btrim(cl.invoice_name)) = lower(btrim(s.customer))
    or lower(btrim(coalesce(cl.app_name, ''))) = lower(btrim(s.customer))
  where s.status <> 'cancelled'
  group by cl.id, 2
),
agg as (
  select cust_id, count(*) as rep_count, min(rep) as only_rep
  from sale_rep group by cust_id
)
update customer_locations cl
set assigned_rep = a.only_rep,
    assigned_at  = now(),
    assigned_by  = 'bulk assign from app sales, 29 Sep 2026'
from agg a
where a.cust_id = cl.id
  and (cl.assigned_rep is null or btrim(cl.assigned_rep) = '')
  and a.rep_count = 1
  and a.only_rep <> '(none)'
returning cl.id, cl.invoice_name, cl.assigned_rep;


-- ===========================================================
-- PART 3 - SEVERAL REPS SELL HERE. Needs a person to choose.
-- Look only. The split is shown so the call can be made on sight.
-- ===========================================================

with sale_rep as (
  select cl.id as cust_id,
         coalesce(nullif(btrim(s.rep_name), ''), '(none)') as rep,
         count(*) as n_orders, sum(s.litres) as litres
  from sales s
  join customer_locations cl
    on lower(btrim(cl.invoice_name)) = lower(btrim(s.customer))
    or lower(btrim(coalesce(cl.app_name, ''))) = lower(btrim(s.customer))
  where s.status <> 'cancelled'
  group by cl.id, 2
)
select cl.id, cl.invoice_name as customer,
       coalesce(nullif(btrim(cl.assigned_rep), ''), '(unassigned)') as current_rep,
       string_agg(sr.rep || ' - ' || sr.n_orders || ' ord / ' || round(sr.litres) || ' L',
                  '  |  ' order by sr.litres desc) as who_has_sold_here,
       round(sum(sr.litres)) as app_litres
from customer_locations cl
join sale_rep sr on sr.cust_id = cl.id
group by cl.id, cl.invoice_name, cl.assigned_rep
having count(*) > 1
order by sum(sr.litres) desc;


-- ===========================================================
-- PART 4 - ALREADY ASSIGNED, BUT SOMEBODY ELSE IS SELLING THERE.
-- Not necessarily wrong - a rep can cover for a colleague - but worth a look,
-- because it is also what a customer quietly changing hands looks like.
-- ===========================================================

with sale_rep as (
  select cl.id as cust_id,
         coalesce(nullif(btrim(s.rep_name), ''), '(none)') as rep,
         count(*) as n_orders, sum(s.litres) as litres
  from sales s
  join customer_locations cl
    on lower(btrim(cl.invoice_name)) = lower(btrim(s.customer))
    or lower(btrim(coalesce(cl.app_name, ''))) = lower(btrim(s.customer))
  where s.status <> 'cancelled'
  group by cl.id, 2
),
top_rep as (
  select distinct on (cust_id) cust_id, rep, n_orders, litres
  from sale_rep order by cust_id, litres desc, n_orders desc
)
select cl.id, cl.invoice_name as customer,
       btrim(cl.assigned_rep) as assigned_to,
       tr.rep as but_mostly_sold_by,
       tr.n_orders, round(tr.litres) as litres
from customer_locations cl
join top_rep tr on tr.cust_id = cl.id
where btrim(coalesce(cl.assigned_rep, '')) <> ''
  and btrim(cl.assigned_rep) <> tr.rep
order by tr.litres desc;


-- ===========================================================
-- PART 5 - THE MANUAL CALLS. Tom's decisions, 29 Sep 2026.
-- These are the customers two reps had both sold to, so no rule could pick
-- one. Recorded by id rather than name so a later name tidy-up cannot make
-- these updates silently miss.
--
-- Not listed here, and deliberately: Fuelbuddy (id 66) stays with Niel and
-- Geosource (id 69) stays with Tom Eager CW - both already held that value,
-- so there is nothing to write. Note Fuelbuddy will keep showing in the
-- Part 4 mismatch list, because Marshall has logged all four of its orders.
-- ===========================================================

update customer_locations
set assigned_rep = v.rep, assigned_at = now(), assigned_by = 'manual - Tom, 29 Sep 2026'
from (values
  (84,  'Niel Martin'),      -- JR Goddard Contracting   (Tom 18/423k vs Niel 17/401k)
  (74,  'Mack Charlie'),     -- Gridrock t/a Newtown     (Mack 6/97k vs Marshall 1/23k)
  (65,  'Niel Martin'),      -- Fuchs Zimbabwe           (Niel 4/42k vs Marshall 1/1k)
  (11,  'Tom Eager CW'),     -- Berry Tech               (CW 4/70k vs Tom 1/10k)
  (141, 'Mack Charlie'),     -- Shengxiang Investments   (Marshall 1/30k vs Mack 1/20k)
  (87,  'Niel Martin'),      -- Jumbo Transport          (Niel 1/10k vs Tom 1/10k)
  (41,  'Molly Gwatidah'),   -- Dunlaurie                (Mack 1/14k vs Molly 1/10k)
  (128, 'Niel Martin')       -- Proton Bakers            (Niel 8/215k vs Tom 5/167k)
) as v(id, rep)
where customer_locations.id = v.id;

-- All ambiguous cases are now decided; nothing outstanding in this file.
