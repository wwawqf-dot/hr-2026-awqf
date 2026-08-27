-- =====================================================================
--  Measure the allocation guard against the NET balance, not one row
--  -------------------------------------------------------------------
--  202608280002 refused to lower an employee-year's `added` whenever the
--  new figure fell below that same row's `deducted`. That test was
--  wrong. It asked a question the system never asks — whether a single
--  year's grant covers that single year's deductions — while the real
--  balance, and the only one the app, the deduction guard and every
--  printed statement use, is cumulative:
--
--      employee_net_balance = الرصيد المرحّل
--                           + مجموع (مضاف - مخصوم) عبر كل السنوات
--
--  An employee with a large carried-forward balance can quite properly
--  take 30 days in a year that has so far released 15. Nothing is
--  overdrawn; the days came out of the carry-forward. The old test read
--  that healthy state as a violation and refused to correct three
--  perfectly ordinary rows:
--
--      اسماعيل   118 + 15 - 21 = 112   ← موجب
--      عبدالفتاح  78 + 15 - 24 =  69   ← موجب
--      عمار       53 + 15 - 30 =  38   ← موجب
--
--  The guard itself is still needed — a correction must never leave an
--  employee owing days they have already taken — so it is not removed,
--  it is asked the right question: would this change push the employee's
--  NET balance below zero?
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. THE REPAIR ENGINE, RE-GUARDED
-- ---------------------------------------------------------------------
-- Deltas are summed PER EMPLOYEE before the test, so an employee whose
-- rows change in several years is judged on their combined effect rather
-- than one row at a time.
--
-- The unpaid-leave case carries a delta of zero on the current year:
-- employee_net_balance() already excludes that year's grant for them, so
-- changing it moves their balance by nothing and can never overdraw it.
create or replace function public.reconcile_allocations(p_employee_ids bigint[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cur_year text := to_char((now() at time zone 'Africa/Tripoli')::date, 'YYYY');
    v_created  int  := 0;
    v_fixed    int  := 0;
    v_blocked  jsonb;
begin
    -- Grant the year to an active employee who has no row for it — the
    -- archived-then-restored case add_year() could never have seen.
    insert into public.employee_years (employee_id, year, added, deducted)
    select e.id, y.year,
           public.year_allocation(y.year, e.over_45, e.hire_date_current_year,
                                  coalesce(y.default_days, 30)), 0
      from public.employees e
      cross join public.years y
     where e.is_archived = false
       and coalesce(y.is_archived, false) = false
       and y.year ~ '^\d{4}$'
       and y.year >= v_cur_year
       and (p_employee_ids is null or e.id = any(p_employee_ids))
       and not exists (select 1 from public.employee_years ey
                        where ey.employee_id = e.id and ey.year = y.year)
    on conflict (employee_id, year) do nothing;
    get diagnostics v_created = row_count;

    with cand as (
        select ey.id, ey.employee_id, ey.year,
               ey.added    as stored,
               ey.deducted as deducted,
               public.year_allocation(ey.year, e.over_45, e.hire_date_current_year,
                                      coalesce(y.default_days, 30)) as owed,
               e.is_unpaid_leave
          from public.employee_years ey
          join public.employees e on e.id = ey.employee_id
          join public.years     y on y.year = ey.year
         where e.is_archived = false
           and coalesce(y.is_archived, false) = false
           and ey.year ~ '^\d{4}$'
           and ey.year >= v_cur_year
           and (p_employee_ids is null or ey.employee_id = any(p_employee_ids))
    ),
    changed as (
        select *, case when is_unpaid_leave and year = v_cur_year
                       then 0 else owed - stored end as delta
          from cand
         where owed is distinct from stored
    ),
    solvent as (
        select c.employee_id
          from changed c
         group by c.employee_id
        having public.employee_net_balance(c.employee_id) + sum(c.delta) >= 0
    ),
    applied as (
        update public.employee_years ey
           set added = c.owed
          from changed c
          join solvent s on s.employee_id = c.employee_id
         where ey.id = c.id
        returning 1
    )
    select count(*) into v_fixed from applied;

    -- Whatever still mismatches is, by construction, a row the guard
    -- refused. Report the resulting net so the reason is visible.
    select coalesce(jsonb_agg(jsonb_build_object(
               'employee',   e.name,
               'job_number', coalesce(e.job_number, ''),
               'year',       ey.year,
               'stored',     ey.added,
               'correct',    v.owed,
               'deducted',   ey.deducted,
               'net',        public.employee_net_balance(e.id) + (v.owed - ey.added)
           ) order by e.name), '[]'::jsonb)
      into v_blocked
      from public.employee_years ey
      join public.employees e on e.id = ey.employee_id
      join public.years     y on y.year = ey.year
      cross join lateral (
           select public.year_allocation(ey.year, e.over_45, e.hire_date_current_year,
                                         coalesce(y.default_days, 30)) as owed) v
     where e.is_archived = false
       and coalesce(y.is_archived, false) = false
       and ey.year ~ '^\d{4}$'
       and ey.year >= v_cur_year
       and (p_employee_ids is null or ey.employee_id = any(p_employee_ids))
       and v.owed is distinct from ey.added;

    return jsonb_build_object('created', v_created,
                              'fixed',   v_fixed,
                              'blocked', v_blocked);
end;
$$;


-- ---------------------------------------------------------------------
-- 2. APPLY IT TO THE ROWS THE OLD GUARD WRONGLY REFUSED
-- ---------------------------------------------------------------------
do $$
declare r jsonb;
begin
    r := public.reconcile_allocations(null);
    raise notice 'net-balance guard: created=% fixed=% still-blocked=%',
        r->>'created', r->>'fixed', jsonb_array_length(r->'blocked');
    if jsonb_array_length(r->'blocked') > 0 then
        raise warning 'صفوف لم تُصحَّح لأن التعديل كان سيجعل الرصيد التراكمي سالباً: %', r->'blocked';
    end if;
end;
$$;
