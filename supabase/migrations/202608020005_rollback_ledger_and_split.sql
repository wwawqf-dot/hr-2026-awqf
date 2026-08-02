-- =====================================================================
--  ROLLBACK: restore get_employee_json / register_deduction / add_year /
--  delete_deduction to their state immediately before migrations
--  202608020002 (year-close finalize) and 202608020003 (cross-year
--  split) — i.e. exactly the 202507200007_official_holidays_tracking.sql
--  / 202507190001_soft_delete_archive.sql versions.
--  ---------------------------------------------------------------------
--  The employee list broke live (list_employees -> get_employee_json)
--  immediately after those two migrations were applied. Rather than
--  debug under live pressure, this restores the last confirmed-working
--  versions verbatim so the site works again now; the underlying bugs
--  can be found and reintroduced carefully afterward.
--
--  NOT reverted: handle_new_user / consume_invite_code (the
--  202608020001 security fix) — a completely separate code path
--  (sign-up/role-grant), unrelated to this failure, and reverting it
--  would reopen a real admin-escalation hole for no benefit.
--
--  official_holidays / split_group_id columns are left in place
--  (harmless, unused once these functions stop referencing the latter).
-- =====================================================================

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
        'include_in_print', e.include_in_print,
        'is_unpaid_leave', e.is_unpaid_leave,
        'is_archived', e.is_archived,
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
                       'deductionSource', d.deduction_source,
                       'officialHolidays', d.official_holidays
                   ) order by d.id)
            from public.deductions d where d.employee_id = e.id
        ), '[]'::jsonb),
        'createdAt', e.created_at
    )
    from public.employees e where e.id = p_id;
$$;

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
    v_official_holidays numeric;
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
        v_official_holidays := p_holidays;
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
        v_official_holidays := 0;
    else
        raise exception 'يرجى تحديد تاريخ البداية والنهاية أو عدد أيام الخصم';
    end if;

    v_monthly_rate := case when emp.over_45 then 3.75 else 2.5 end;
    v_dynamic_added := public.calculate_dynamic_accrual(v_monthly_rate, emp.hire_date_current_year);

    if not emp.is_unpaid_leave then
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

    insert into public.employee_years (employee_id, year, added, deducted)
    values (emp.id, v_year, v_dynamic_added, 0)
    on conflict (employee_id, year) do update set added = v_dynamic_added;

    update public.employee_years set deducted = deducted + v_days
        where employee_id = emp.id and year = v_year;

    if not emp.is_unpaid_leave then
        if coalesce((select coalesce(emp.initial_carried_forward, 0)
                      + sum(coalesce(added, 0) - coalesce(deducted, 0))
                      - coalesce((select coalesce(added, 0) from public.employee_years
                                   where employee_id = emp.id and year = v_latest), 0)
                      + v_dynamic_added
                 from public.employee_years where employee_id = emp.id), 0) < 0 then
            raise exception 'خطأ داخلي: الرصيد سالب بعد الخصم - تم إلغاء العملية';
        end if;
    end if;

    insert into public.deductions (employee_id, year, start_date, end_date, days, note, created_by, created_at, official_holidays)
    values (emp.id, v_year, v_start, v_end, v_days, v_note, v_username, now(), v_official_holidays);

    perform public.log_action(v_role, v_username, 'تسجيل خصم إجازة',
        format('تم خصم %s يوم من رصيد %s لسنة %s%s', v_days, emp.name, v_year,
               case when v_has_dates then '' else ' (بدون تاريخ محدد)' end));

    return jsonb_build_object('employee', public.get_employee_json(emp.id));
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
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then raise exception 'هذه العملية مقصورة على المدير'; end if;
    v_year := trim(coalesce(p_year, ''));
    if v_year !~ '^\d{4}$' then raise exception 'يرجى إدخال سنة مالية صحيحة'; end if;

    if exists (select 1 from public.years where year = v_year and is_archived = false) then
        raise exception 'هذه السنة مسجلة مسبقاً';
    end if;
    v_was_archived := exists (select 1 from public.years where year = v_year and is_archived = true);
    v_default := coalesce(p_default_days, 30);

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

create or replace function public.delete_deduction(p_deduction_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_username text; d public.deductions%rowtype;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    select * into d from public.deductions where id = p_deduction_id for update;
    if not found then raise exception 'سجل الخصم غير موجود'; end if;

    update public.employee_years set deducted = greatest(0, deducted - d.days)
        where employee_id = d.employee_id and year = d.year;
    delete from public.deductions where id = d.id;

    perform public.log_action(v_role, v_username, 'حذف خصم إجازة',
        format('تم حذف خصم %s يوم', d.days));
    return jsonb_build_object('employee', public.get_employee_json(d.employee_id));
end;
$$;
