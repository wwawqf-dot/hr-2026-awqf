-- =====================================================================
--  Migration: Dynamic accrual for Phantom Balance fix
--  ---------------------------------------------------------------------
--  Problem: register_deduction's balance check used the stored `added`
--  column (full-year allocation 30/45) even for the current in-progress
--  year. This created a phantom balance — employees appeared to have
--  accrued a full 30 days in January, allowing them to borrow against
--  future unearned months.
--
--  Fix:
--   1. Create calculate_dynamic_accrual() — reproduces the exact
--      front-end logic (getAccruedDays) in PL/pgSQL.
--   2. In register_deduction's balance check, replace the current
--      year's stored `added` with the dynamically-calculated value.
--   3. On INSERT/UPDATE of employee_years, store the dynamic value
--      so that any raw-data reads also see the correct accrual.
-- =====================================================================

create or replace function public.calculate_dynamic_accrual(
    p_monthly_rate           numeric,
    p_hire_date_current_year date default null
) returns numeric
language plpgsql
stable
as $$
declare
    v_curr_month    int;
    v_cutoff_month  int;
    v_hire_month    int;
    v_hire_day      int;
    v_first_month   int;
    v_months        int;
begin
    v_curr_month   := extract(month from now() at time zone 'Africa/Tripoli');
    v_cutoff_month := v_curr_month - 1;  -- last fully-completed month

    if p_hire_date_current_year is not null
       and extract(year from p_hire_date_current_year) = extract(year from now() at time zone 'Africa/Tripoli')
    then
        -- Mid-year hire: 15th-day rule
        v_hire_month := extract(month from p_hire_date_current_year);
        v_hire_day   := extract(day   from p_hire_date_current_year);

        if v_hire_month > v_cutoff_month then
            return 0;
        end if;

        v_first_month := case when v_hire_day > 15 then v_hire_month + 1 else v_hire_month end;

        if v_first_month > v_cutoff_month then
            return 0;
        end if;

        v_months := v_cutoff_month - v_first_month + 1;
    else
        -- Standard accrual: months elapsed this year (current month not yet complete)
        v_months := greatest(0, v_cutoff_month);
    end if;

    return round((v_months * p_monthly_rate)::numeric, 2);
end;
$$;

grant execute on function public.calculate_dynamic_accrual(numeric, date) to authenticated;

create or replace function public.register_deduction(p_employee_id bigint, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text; v_username text; emp public.employees%rowtype;
    v_has_dates boolean; v_has_unknown boolean;
    v_years text[]; v_latest text; v_start_year text;
    v_year text; v_days numeric; v_start text := ''; v_end text := '';
    v_retro int; v_net numeric; v_note text;
    v_monthly_rate numeric; v_dynamic_added numeric;
    p_start text := nullif(p_payload->>'start', '');
    p_end   text := nullif(p_payload->>'end', '');
    p_holidays numeric := coalesce((p_payload->>'customHolidays')::numeric, 0);
    p_unknown  text := nullif(trim(coalesce(p_payload->>'unknownDays','')), '');
begin
    if auth.uid() is null then raise exception 'غير مصرح'; end if;
    select role, coalesce(username, '') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is null then raise exception 'الحساب غير مُهيأ'; end if;

    select * into emp from public.employees where id = p_employee_id for update;
    if not found then raise exception 'الموظف غير موجود'; end if;
    v_note := nullif(left(trim(coalesce(p_payload->>'note','')), 500), '');

    select array_agg(year order by cast(year as integer)) into v_years
        from public.years where coalesce(is_archived, false) = false;
    if v_years is null then raise exception 'لا توجد سنة مالية نشطة لتسجيل الخصم'; end if;
    v_latest := v_years[array_length(v_years, 1)];

    v_has_dates   := (p_start is not null and p_end is not null);
    v_has_unknown := (p_unknown is not null);

    if v_has_dates then
        v_start_year := split_part(p_start, '-', 1);
        if v_start_year is distinct from v_latest then
            raise exception 'لا يمكن تسجيل الإجازة: تاريخ الإجازة يقع خارج السنة المالية النشطة حالياً. يرجى إغلاق السنة الحالية أو تفعيل السنة المناسبة.';
        end if;
        v_year := v_start_year;
        if p_holidays < 0 then
            raise exception 'لا يمكن أن يكون عدد العطلات الرسمية سالباً';
        end if;
        v_days := public.calculate_deduction_days(p_start::date, p_end::date, p_holidays);
        if v_days <= 0 then
            raise exception 'يجب أن يكون عدد أيام الخصم أكبر من صفر';
        end if;
        if v_days > 366 then
            raise exception 'لا يمكن تسجيل خصم يتجاوز 366 يوماً في عملية واحدة';
        end if;
        v_retro := ((now() at time zone 'Africa/Tripoli')::date - p_start::date);
        if v_retro > 40 then
            raise exception 'لا يمكن تسجيل إجازة بتاريخ رجعي يتجاوز 40 يوماً من تاريخ النظام الحالي.';
        end if;
        v_start := p_start; v_end := p_end;

        -- Strict partial overlap guard bound to the active financial year.
        -- Catches any partial, full, or enclosing overlap between the new
        -- dated deduction and any existing deduction for the same employee
        -- within the same year. Cross-year false positives are impossible
        -- because year = v_year is checked.
        if exists (select 1 from public.deductions
                    where employee_id = emp.id
                    and year = v_year
                    and start_date <> ''
                    and end_date <> ''
                    and start_date::date <= v_end::date
                    and end_date::date >= v_start::date) then
            raise exception 'يوجد تداخل زمني مع إجازة أخرى مسجلة مسبقاً لهذا الموظف. الأيام محجوزة.';
        end if;
    elsif v_has_unknown then
        v_days := p_unknown::numeric;
        if not (v_days > 0) then
            raise exception 'يرجى إدخال عدد أيام صحيح أكبر من صفر';
        end if;
        if v_days > 366 then
            raise exception 'لا يمكن تسجيل خصم يتجاوز 366 يوماً في عملية واحدة';
        end if;
        v_year := v_latest;
    else
        raise exception 'يرجى تحديد تاريخ البداية والنهاية أو عدد أيام الخصم';
    end if;

    -- Dynamic accrual: compute what the employee has actually earned so far
    v_monthly_rate := case when emp.over_45 then 3.75 else 2.5 end;
    v_dynamic_added := public.calculate_dynamic_accrual(v_monthly_rate, emp.hire_date_current_year);

    if not emp.is_unpaid_leave then
        -- Balance check: replace current year's stored added with dynamic accrual
        select coalesce(emp.initial_carried_forward, 0)
             + coalesce(sum(coalesce(added, 0) - coalesce(deducted, 0)), 0)
             - coalesce((select coalesce(added, 0) from public.employee_years
                          where employee_id = emp.id and year = v_latest), 0)
             + v_dynamic_added
          into v_net
          from public.employee_years where employee_id = emp.id;
        if v_days > v_net then
            raise exception 'فشلت العملية: رصيد الموظف الحالي غير كافٍ لتغطية عدد أيام الخصم المطلوبة.';
        end if;
    end if;

    -- Store dynamic added so raw-data reads also see the correct accrual
    insert into public.employee_years (employee_id, year, added, deducted)
    values (emp.id, v_year, v_dynamic_added, 0)
    on conflict (employee_id, year) do update set added = v_dynamic_added;

    update public.employee_years set deducted = deducted + v_days
        where employee_id = emp.id and year = v_year;

    if not emp.is_unpaid_leave then
        -- Post-update sanity check (same dynamic-accrual logic)
        if coalesce((select coalesce(emp.initial_carried_forward, 0)
                      + sum(coalesce(added, 0) - coalesce(deducted, 0))
                      - coalesce((select coalesce(added, 0) from public.employee_years
                                   where employee_id = emp.id and year = v_latest), 0)
                      + v_dynamic_added
                 from public.employee_years where employee_id = emp.id), 0) < 0 then
            raise exception 'خطأ داخلي: الرصيف سالب بعد الخصم - تم إلغاء العملية';
        end if;
    end if;

    insert into public.deductions (employee_id, year, start_date, end_date, days, note, created_by, created_at)
    values (emp.id, v_year, v_start, v_end, v_days, v_note, v_username, now());

    perform public.log_action(v_role, v_username, 'تسجيل خصم إجازة',
        format('تم خصم %s يوم من رصيد %s لسنة %s%s', v_days, emp.name, v_year,
               case when v_has_dates then '' else ' (بدون تاريخ محدد)' end));

    return jsonb_build_object('employee', public.get_employee_json(emp.id));
end;
$$;

grant execute on function public.register_deduction(bigint, jsonb) to authenticated;
