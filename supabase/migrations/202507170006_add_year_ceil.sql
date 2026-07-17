-- =====================================================================
--  Migration: CEIL rounding on year-end rollover
--  - Adds carryover_ceiled_at_year + ceiled_cumulative_balance columns
--  - Updates add_year RPC to CEIL running balance at year creation
--  - Updates get_employee_json to expose the new fields
-- =====================================================================

alter table public.employees
    add column if not exists ceiled_cumulative_balance numeric default null,
    add column if not exists carryover_ceiled_at_year text default null;

create or replace function public.add_year(p_year text, p_default_days numeric default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_username text; v_year text; v_default numeric;
    emp record;
    v_running numeric;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then raise exception 'هذه العملية مقصورة على المدير'; end if;
    v_year := trim(coalesce(p_year, ''));
    if v_year !~ '^\d{4}$' then raise exception 'يرجى إدخال سنة مالية صحيحة'; end if;
    if exists (select 1 from public.years where year = v_year) then
        raise exception 'هذه السنة مسجلة مسبقاً';
    end if;
    v_default := coalesce(p_default_days, 30);
    insert into public.years (year) values (v_year);
    insert into public.employee_years (employee_id, year, added, deducted)
    select id, v_year, case when over_45 then 45 else v_default end, 0 from public.employees
    on conflict (employee_id, year) do nothing;
    -- CEIL running balance for every employee and record the boundary year
    for emp in select e.id, e.initial_carried_forward from public.employees e loop
        select coalesce(emp.initial_carried_forward, 0)
             + coalesce(sum(coalesce(added,0) - coalesce(deducted,0)), 0)
          into v_running
          from public.employee_years where employee_id = emp.id;
        update public.employees set
            ceiled_cumulative_balance = ceil(v_running),
            carryover_ceiled_at_year = v_year
        where id = emp.id;
    end loop;
    perform public.log_action(v_role, v_username, 'إضافة سنة مالية', format('السنة: %s', v_year));
    return jsonb_build_object('years',
        coalesce((select jsonb_agg(year order by cast(year as integer)) from public.years), '[]'::jsonb));
end;
$$;

create or replace function public.get_employee_json(p_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'id', e.id,
        'name', e.name,
        'job_number', coalesce(e.job_number, ''),
        'national_id', coalesce(e.national_id, ''),
        'job_title', coalesce(e.job_title, ''),
        'initial_carried_forward', e.initial_carried_forward,
        'over_45', e.over_45,
        'is_frozen', e.is_frozen,
        'hire_date', coalesce(e.hire_date, ''),
        'hire_date_current_year', e.hire_date_current_year,
        'ceiled_cumulative_balance', e.ceiled_cumulative_balance,
        'carryover_ceiled_at_year', e.carryover_ceiled_at_year,
        'years_data', coalesce((
            select jsonb_object_agg(ey.year,
                       jsonb_build_object('added', ey.added, 'deducted', ey.deducted))
            from public.employee_years ey where ey.employee_id = e.id
        ), '{}'::jsonb),
        'deductions_history', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', d.id, 'year', d.year, 'start', d.start_date,
                       'end', d.end_date, 'days', d.days, 'note', d.note,
                       'createdBy', d.created_by, 'createdAt', d.created_at,
                       'deductionSource', d.deduction_source
                   ) order by d.id)
            from public.deductions d where d.employee_id = e.id
        ), '[]'::jsonb),
        'createdAt', e.created_at
    )
    from public.employees e where e.id = p_id;
$$;
