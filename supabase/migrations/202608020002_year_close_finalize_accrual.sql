-- =====================================================================
--  Migration: Finalize a year's true accrual when it closes
--  ---------------------------------------------------------------------
--  Problem: register_deduction persists calculate_dynamic_accrual()'s
--  result — "accrued AS OF RIGHT NOW" — into employee_years.added on
--  every deduction, so the currently-open year's stored `added` is
--  whatever partial figure happened to be true at the moment of the
--  LAST deduction made during that year. The frontend
--  (computeYearlyLedger in leaveCalc.js) only recomputes dynamically for
--  the year that is STILL current; once a year closes it trusts the
--  stored `added` verbatim, forever. If no deduction happens to land in
--  the year's final month(s), or if it's read straight from raw data,
--  the closed year's `added` is stuck at a stale partial value instead
--  of the true full-year (or full-tenure, for a mid-year hire) total —
--  silently losing the employee real balance days the moment the next
--  year opens and add_year() ceils the running total using that wrong
--  figure.
--
--  Not yet a live data problem: as of this migration, 2026 is still the
--  open year (no year has closed since dynamic accrual was introduced),
--  so nothing has been permanently corrupted yet. This is a preventive
--  fix, timed to land before the first year-end rollover.
--
--  Fix: whenever add_year() opens a new year, it now finalizes every
--  still-open PRIOR year's `added` to the true, deterministic full-year
--  total — computed with cutoff_month hardcoded to 12 (the year has
--  fully elapsed, so every month is complete) rather than derived from
--  whatever moment add_year happens to be clicked — before folding it
--  into ceiled_cumulative_balance. This makes the closing figure exact
--  regardless of deduction timing/history during the year.
-- =====================================================================

create or replace function public.calculate_year_final_accrual(
    p_monthly_rate           numeric,
    p_hire_date_current_year date,
    p_target_year            text
) returns numeric
language plpgsql
stable
as $$
declare
    v_hire_month  int;
    v_hire_day    int;
    v_first_month int;
begin
    -- The year in question has fully elapsed by the time it closes, so
    -- unlike calculate_dynamic_accrual (which asks "as of now, this
    -- month not yet complete"), every one of its 12 months counts as a
    -- completed month.
    if p_hire_date_current_year is not null
       and extract(year from p_hire_date_current_year)::text = p_target_year
    then
        -- Mid-year hire within THIS year: same 15th-day proration rule
        -- as calculate_dynamic_accrual, with cutoff_month fixed at 12.
        v_hire_month := extract(month from p_hire_date_current_year);
        v_hire_day   := extract(day   from p_hire_date_current_year);
        v_first_month := case when v_hire_day > 15 then v_hire_month + 1 else v_hire_month end;
        if v_first_month > 12 then
            return 0;
        end if;
        return round(((12 - v_first_month + 1) * p_monthly_rate)::numeric, 2);
    end if;

    return round((12 * p_monthly_rate)::numeric, 2);
end;
$$;

create or replace function public.add_year(p_year text, p_default_days numeric default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_username text; v_year text; v_default numeric;
    emp record;
    v_running numeric;
    v_was_archived boolean;
    v_closing_year text;
    v_monthly_rate numeric;
    v_final_added numeric;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then raise exception 'هذه العملية مقصورة على المدير'; end if;
    v_year := trim(coalesce(p_year, ''));
    if v_year !~ '^\d{4}$' then raise exception 'صيغة السنة يجب أن تكون أربعة أرقام'; end if;

    if exists (select 1 from public.years where year = v_year and is_archived = false) then
        raise exception 'هذه السنة مفتوحة بالفعل';
    end if;
    v_was_archived := exists (select 1 from public.years where year = v_year and is_archived = true);
    v_default := coalesce(p_default_days, 30);

    -- Finalize every still-open PRIOR year's accrual before it becomes
    -- historical. Must run before the ceiling loop below so the ceiled
    -- balance reflects the corrected figure, not the stale one.
    for emp in
        select e.id, e.over_45, e.hire_date_current_year, e.is_unpaid_leave
        from public.employees e where e.is_archived = false
    loop
        v_monthly_rate := case when emp.over_45 then 3.75 else 2.5 end;
        for v_closing_year in
            select y.year from public.years y
            where y.is_archived = false and cast(y.year as integer) < cast(v_year as integer)
        loop
            -- Unpaid-leave freeze applies the same way it does live: no
            -- accrual for the year(s) the employee was on unpaid leave.
            v_final_added := case when emp.is_unpaid_leave then 0
                else public.calculate_year_final_accrual(v_monthly_rate, emp.hire_date_current_year, v_closing_year)
            end;
            update public.employee_years
                set added = v_final_added
                where employee_id = emp.id and year = v_closing_year;
        end loop;
    end loop;

    if v_was_archived then
        update public.years set is_archived = false where year = v_year;
    else
        insert into public.years (year) values (v_year);
    end if;

    insert into public.employee_years (employee_id, year, added, deducted)
    select id, v_year, case when over_45 then 45 else v_default end, 0
        from public.employees where is_archived = false
    on conflict (employee_id, year) do nothing;

    for emp in select e.id, e.initial_carried_forward from public.employees e where e.is_archived = false loop
        select coalesce(emp.initial_carried_forward, 0)
             + coalesce(sum(coalesce(added,0) - coalesce(deducted,0)), 0)
          into v_running
          from public.employee_years where employee_id = emp.id;
        update public.employees set
            ceiled_cumulative_balance = ceil(v_running),
            carryover_ceiled_at_year = v_year
        where id = emp.id;
    end loop;

    perform public.log_action(v_role, v_username, 'فتح سنة مالية', format('السنة: %s', v_year));
    return jsonb_build_object('years',
        coalesce((select jsonb_agg(year order by cast(year as integer))
                  from public.years where is_archived = false), '[]'::jsonb));
end;
$$;

grant execute on function public.calculate_year_final_accrual(numeric, date, text) to authenticated;
