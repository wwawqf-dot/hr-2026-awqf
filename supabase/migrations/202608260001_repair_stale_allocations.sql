-- =====================================================================
--  Repair the allocations the old accrual engine used to hide
--  -------------------------------------------------------------------
--  Moving to manual allocation made employee_years.added the truth. That
--  exposed two pre-existing defects that the dynamic display had been
--  papering over for as long as it existed, because it recomputed the
--  current year's figure from `employees.over_45` on every single render
--  and never consulted the stored row at all:
--
--   1  A STALE GRANT. `added` is written once, when the year is opened
--      (add_year) or the employee is created (create_employee), from the
--      employee's over_45 flag AT THAT MOMENT. update_employee changed
--      employees.over_45 but never revisited employee_years.added. So an
--      employee who was moved onto the 45-day track after their year row
--      already existed still carries a stored 30. The old UI hid this
--      completely — it read over_45 live and drew the 45 track — and the
--      moment the stored number became the truth, that employee dropped
--      back to 30. This is the reported "الموظف المفروض يضاف له 45 لم
--      يضف له، بقي كما هو".
--
--   2  A MISSING ROW ENTIRELY. add_year() grants the year to non-archived
--      employees only, and restore_employee() merely clears is_archived
--      without re-granting anything. An employee who was archived when
--      the year was opened and restored afterwards therefore has NO row
--      for that year. The old code invented a number for them anyway
--      (`if (!yearsData[currentYear]) balance += getAccruedDays(...)`),
--      so nobody could see the row was absent; now they render 0. This
--      is the reported "بعض الموظفين تم إضافة 30 وفي البعض لا".
--
--  Both are the same class of bug — a stored allocation that was never
--  reconciled with the employee it belongs to — so both get one repair.
--
--  SCOPE, deliberately tight. Only the CURRENT financial year and any
--  year opened ahead of it are touched. That is exactly the set the old
--  dynamic engine used to recompute, so this repair cannot rewrite a
--  single figure that the admin has already been reading as settled
--  history: every closed and archived year is left exactly as it is.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. THE REPAIR ENGINE
-- ---------------------------------------------------------------------
-- Internal, like reconcile_counters(): only the admin-guarded wrapper
-- below may drive it. Returns what it did rather than a bare count,
-- because the rows it CANNOT fix are the ones an admin must see.
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
    -- (2) Grant the year to an active employee who has no row for it —
    -- the archived-then-restored case add_year() could never have seen.
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

    -- (1) Re-derive the stored grant from what the employee IS today:
    -- their track, their hire date, and the year's configured allocation.
    with target as (
        select ey.id,
               ey.added    as old_added,
               ey.deducted as deducted,
               public.year_allocation(ey.year, e.over_45, e.hire_date_current_year,
                                      coalesce(y.default_days, 30)) as new_added
          from public.employee_years ey
          join public.employees e on e.id = ey.employee_id
          join public.years     y on y.year = ey.year
         where e.is_archived = false
           and coalesce(y.is_archived, false) = false
           and ey.year ~ '^\d{4}$'
           and ey.year >= v_cur_year
           and (p_employee_ids is null or ey.employee_id = any(p_employee_ids))
    ),
    applied as (
        update public.employee_years ey
           set added = t.new_added
          from target t
         where ey.id = t.id
           and t.new_added is distinct from t.old_added
           -- A correction that lands BELOW the days already taken would
           -- turn an approved leave into a debt. Those rows are left
           -- alone and reported instead, for a human to settle.
           and t.new_added >= t.deducted
        returning 1
    )
    select count(*) into v_fixed from applied;

    -- Anything still mismatched after that pass is, by construction, a
    -- row the guard above refused. Name it so the admin can act on it.
    select coalesce(jsonb_agg(jsonb_build_object(
               'employee',   e.name,
               'job_number', coalesce(e.job_number, ''),
               'year',       ey.year,
               'stored',     ey.added,
               'correct',    v.new_added,
               'deducted',   ey.deducted) order by e.name), '[]'::jsonb)
      into v_blocked
      from public.employee_years ey
      join public.employees e on e.id = ey.employee_id
      join public.years     y on y.year = ey.year
      cross join lateral (
           select public.year_allocation(ey.year, e.over_45, e.hire_date_current_year,
                                         coalesce(y.default_days, 30)) as new_added) v
     where e.is_archived = false
       and coalesce(y.is_archived, false) = false
       and ey.year ~ '^\d{4}$'
       and ey.year >= v_cur_year
       and (p_employee_ids is null or ey.employee_id = any(p_employee_ids))
       and v.new_added is distinct from ey.added;

    return jsonb_build_object('created', v_created,
                              'fixed',   v_fixed,
                              'blocked', v_blocked);
end;
$$;


-- ---------------------------------------------------------------------
-- 2. THE ADMIN ENTRY POINT — one button, one complete repair
-- ---------------------------------------------------------------------
-- The Settings button already existed for the deduction counters. Under
-- manual allocation the grant needs the same treatment, so the button
-- now repairs both halves of an employee-year row rather than half of it.
--
-- Order matters: the counters are rebuilt from the deduction register
-- FIRST, so the allocation pass measures its "would this fall below the
-- days already taken" guard against a corrected `deducted`, never a
-- drifted one.
create or replace function public.reconcile_all_counters()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text; v_username text;
    v_counters int;
    v_alloc jsonb;
begin
    select role, coalesce(username, '') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;

    v_counters := public.reconcile_counters(null);
    v_alloc    := public.reconcile_allocations(null);

    perform public.log_action(v_role, v_username, 'مطابقة الأرصدة والعدّادات',
        format('عدّادات خصم صُحّحت: %s، أرصدة سنوية صُحّحت: %s، صفوف أُنشئت: %s، صفوف تعذّر تصحيحها: %s',
               v_counters,
               v_alloc->>'fixed',
               v_alloc->>'created',
               jsonb_array_length(v_alloc->'blocked')));

    return jsonb_build_object(
        'fixed',       v_counters,                          -- kept: existing callers read this
        'allocFixed',  (v_alloc->>'fixed')::int,
        'allocAdded',  (v_alloc->>'created')::int,
        'blocked',     v_alloc->'blocked');
end;
$$;


-- ---------------------------------------------------------------------
-- 3. RUN IT ONCE, NOW
-- ---------------------------------------------------------------------
-- The employees already carrying a stale or missing grant cannot wait
-- for someone to press the button; the previous migration is what made
-- their stored figure visible, so this migration is what settles it.
do $$
declare r jsonb;
begin
    r := public.reconcile_allocations(null);
    raise notice 'reconcile_allocations: created=% fixed=% blocked=%',
        r->>'created', r->>'fixed', jsonb_array_length(r->'blocked');
end;
$$;


-- ---------------------------------------------------------------------
-- 4. GRANTS
-- ---------------------------------------------------------------------
-- reconcile_allocations() is the internal engine; only the admin wrapper
-- may drive it, exactly as with reconcile_counters().
revoke all on function public.reconcile_allocations(bigint[]) from public;
revoke all on function public.reconcile_allocations(bigint[]) from anon;
revoke all on function public.reconcile_allocations(bigint[]) from authenticated;

grant execute on function public.reconcile_all_counters() to authenticated;
