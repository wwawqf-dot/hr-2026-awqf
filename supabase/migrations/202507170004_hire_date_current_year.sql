-- =====================================================================
--  Migration: hire_date_current_year — optional nullable date column
--  for mid-year new hires, enabling prorated dynamic leave accrual.
-- =====================================================================

alter table public.employees
    add column if not exists hire_date_current_year date default null;

-- Update get_employee_json to include the new field
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
        'years_data', coalesce((
            select jsonb_object_agg(ey.year,
                       jsonb_build_object('added', ey.added, 'deducted', ey.deducted))
            from public.employee_years ey where ey.employee_id = e.id
        ), '{}'::jsonb),
        'deductions_history', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', d.id, 'year', d.year, 'start', d.start_date,
                       'end', d.end_date, 'days', d.days, 'note', d.note,
                       'createdBy', d.created_by, 'createdAt', d.created_at
                   ) order by d.id)
            from public.deductions d where d.employee_id = e.id
        ), '[]'::jsonb),
        'createdAt', e.created_at
    )
    from public.employees e where e.id = p_id;
$$;

-- Update create_employee to accept hire_date_current_year
create or replace function public.create_employee(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text; v_username text;
    v_name text; v_hire text;
    v_hire_current_year date;
    v_recon_note text;
    v_over45 boolean; v_initial numeric;
    v_has_remaining boolean; v_remaining numeric;
    v_years text[]; v_current text; v_year text;
    v_added numeric; v_current_added numeric; v_available numeric; v_consumed numeric;
    v_new_id bigint;
begin
    select role, coalesce(username, '') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;

    v_name := trim(coalesce(p_payload->>'name', ''));
    if v_name = '' then raise exception 'يرجى إدخال اسم الموظف كاملاً'; end if;

    v_hire := trim(coalesce(p_payload->>'hire_date', ''));
    if v_hire <> '' and v_hire !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'تاريخ المباشرة يجب أن يكون بصيغة YYYY-MM-DD';
    end if;

    v_hire_current_year := nullif(p_payload->>'hire_date_current_year', '')::date;
    v_over45  := coalesce((p_payload->>'over_45')::boolean, false);
    v_initial := coalesce((p_payload->>'initial_carried_forward')::numeric, 0);
    v_recon_note := left(trim(coalesce(p_payload->>'reconciliationNote', '')), 500);

    v_has_remaining := nullif(trim(coalesce(p_payload->>'actualRemainingBalance', '')), '') is not null;
    if v_has_remaining then v_remaining := (p_payload->>'actualRemainingBalance')::numeric; end if;

    select array_agg(year order by cast(year as integer)) into v_years from public.years;
    v_current := case when array_length(v_years, 1) is null then null
                      else v_years[array_length(v_years, 1)] end;

    insert into public.employees
        (name, job_number, national_id, job_title, initial_carried_forward, over_45, is_frozen, hire_date, hire_date_current_year, created_at)
    values (
        v_name,
        trim(coalesce(p_payload->>'job_number', '')),
        trim(coalesce(p_payload->>'national_id', '')),
        trim(coalesce(p_payload->>'job_title', '')),
        v_initial, v_over45, false, v_hire, v_hire_current_year, now()
    ) returning id into v_new_id;

    v_current_added := case when v_over45 then 45 else 30 end;
    if v_years is not null then
        foreach v_year in array v_years loop
            v_added := nullif(p_payload->'years_data'->v_year->>'added', '')::numeric;
            if v_added is null then v_added := case when v_over45 then 45 else 30 end; end if;
            insert into public.employee_years (employee_id, year, added, deducted)
            values (v_new_id, v_year, v_added, 0)
            on conflict (employee_id, year) do update set added = excluded.added;
            if v_year = v_current then v_current_added := v_added; end if;
        end loop;
    end if;

    if v_has_remaining and v_current is not null then
        v_available := v_initial + v_current_added;
        v_consumed  := v_available - v_remaining;
        if v_consumed > 0 then
            update public.employee_years set deducted = deducted + v_consumed
                where employee_id = v_new_id and year = v_current;
            insert into public.deductions (employee_id, year, start_date, end_date, days, note, created_by, created_at)
            values (v_new_id, v_current, '', '', v_consumed, v_recon_note, v_username, now());
        end if;
    end if;

    perform public.log_action(v_role, v_username, 'إضافة موظف',
        format('تمت إضافة الموظف: %s', v_name));
    return jsonb_build_object('employee', public.get_employee_json(v_new_id));
end;
$$;

-- Update update_employee to accept hire_date_current_year
create or replace function public.update_employee(p_id bigint, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text; v_username text; emp public.employees%rowtype;
    v_name text; v_hire text; v_hire_current_year date;
    v_recon_note text;
    v_initial numeric; v_has_remaining boolean; v_remaining numeric;
    v_years text[]; v_current text; v_year text; v_added numeric;
    v_net numeric; v_diff numeric; v_recon_days numeric := 0;
    yd_key text; yd_val jsonb;
begin
    select role, coalesce(username, '') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;

    select * into emp from public.employees where id = p_id for update;
    if not found then raise exception 'الموظف غير موجود'; end if;

    v_name := trim(coalesce(p_payload->>'name', ''));
    if v_name = '' then raise exception 'يرجى إدخال اسم الموظف كاملاً'; end if;
    v_hire := trim(coalesce(p_payload->>'hire_date', ''));
    if v_hire <> '' and v_hire !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'تاريخ المباشرة يجب أن يكون بصيغة YYYY-MM-DD';
    end if;

    v_hire_current_year := nullif(p_payload->>'hire_date_current_year', '')::date;
    v_initial := coalesce((p_payload->>'initial_carried_forward')::numeric, 0);
    v_recon_note := left(trim(coalesce(p_payload->>'reconciliationNote', '')), 500);
    v_has_remaining := nullif(trim(coalesce(p_payload->>'actualRemainingBalance', '')), '') is not null;
    if v_has_remaining then v_remaining := (p_payload->>'actualRemainingBalance')::numeric; end if;

    update public.employees set
        name = v_name,
        job_number  = trim(coalesce(p_payload->>'job_number', '')),
        national_id = trim(coalesce(p_payload->>'national_id', '')),
        job_title   = trim(coalesce(p_payload->>'job_title', '')),
        initial_carried_forward = v_initial,
        over_45   = coalesce((p_payload->>'over_45')::boolean, false),
        hire_date = v_hire,
        hire_date_current_year = v_hire_current_year
    where id = p_id;

    if p_payload ? 'years_data' then
        for yd_key, yd_val in select key, value from jsonb_each(p_payload->'years_data') loop
            v_added := nullif(yd_val->>'added', '')::numeric;
            if v_added is not null then
                insert into public.employee_years (employee_id, year, added, deducted)
                values (p_id, yd_key, v_added, 0)
                on conflict (employee_id, year) do update set added = excluded.added;
            end if;
        end loop;
    end if;

    if v_has_remaining then
        select array_agg(year order by cast(year as integer)) into v_years from public.years;
        v_current := case when array_length(v_years, 1) is null then null
                          else v_years[array_length(v_years, 1)] end;
        if v_current is not null then
            select v_initial + coalesce(sum(coalesce(added, 0) - coalesce(deducted, 0)), 0)
                into v_net from public.employee_years where employee_id = p_id;
            v_diff := v_net - v_remaining;
            if v_diff > 0 then
                update public.employee_years set deducted = deducted + v_diff
                    where employee_id = p_id and year = v_current;
                insert into public.deductions (employee_id, year, start_date, end_date, days, note, created_by, created_at)
                values (p_id, v_current, '', '', v_diff, v_recon_note, v_username, now());
                v_recon_days := v_diff;
            end if;
        end if;
    end if;

    perform public.log_action(v_role, v_username, 'تعديل موظف',
        format('تم تعديل الموظف: %s', v_name));
    return jsonb_build_object('employee', public.get_employee_json(p_id),
                              'reconciliationDays', v_recon_days);
end;
$$;

-- Update sync_employees to include hire_date_current_year
create or replace function public.sync_employees(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text; v_username text;
    v_years jsonb; v_settings jsonb;
    emp jsonb; ded jsonb; yv text; yd_key text; yd_val jsonb;
    v_target bigint; v_created int := 0; v_updated int := 0; v_ded int := 0;
begin
    select role, coalesce(username, '') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;

    v_years    := coalesce(p_payload->'years', '[]'::jsonb);
    v_settings := p_payload->'settings';

    for yv in select value from jsonb_array_elements_text(v_years) loop
        if yv ~ '^\d{4}$' then
            insert into public.years (year) values (yv) on conflict (year) do nothing;
        end if;
    end loop;

    for emp in select value from jsonb_array_elements(coalesce(p_payload->'employees', '[]'::jsonb)) loop
        if coalesce(trim(emp->>'name'), '') = '' then continue; end if;

        v_target := null;
        if nullif(emp->>'id', '') is not null then
            select id into v_target from public.employees where id = (emp->>'id')::bigint;
        end if;
        if v_target is null and coalesce(trim(emp->>'job_number'), '') <> '' then
            select id into v_target from public.employees
                where job_number = trim(emp->>'job_number') limit 1;
        end if;

        if v_target is null then
            insert into public.employees
                (id, name, job_number, national_id, job_title, initial_carried_forward, over_45, is_frozen, hire_date, hire_date_current_year, created_at)
            values (
                coalesce(nullif(emp->>'id', '')::bigint,
                         nextval(pg_get_serial_sequence('public.employees', 'id'))),
                trim(emp->>'name'),
                coalesce(trim(emp->>'job_number'), ''),
                coalesce(trim(emp->>'national_id'), ''),
                coalesce(trim(emp->>'job_title'), ''),
                coalesce((emp->>'initial_carried_forward')::numeric, 0),
                coalesce((emp->>'over_45')::boolean, false),
                coalesce((emp->>'is_frozen')::boolean, false),
                coalesce(trim(emp->>'hire_date'), ''),
                coalesce(nullif(emp->>'hire_date_current_year', ''), null)::date,
                coalesce((emp->>'createdAt')::timestamptz, now())
            ) returning id into v_target;
            v_created := v_created + 1;
        else
            update public.employees set
                name = trim(emp->>'name'),
                job_number  = coalesce(trim(emp->>'job_number'), job_number),
                national_id = coalesce(trim(emp->>'national_id'), national_id),
                job_title   = coalesce(trim(emp->>'job_title'), job_title),
                initial_carried_forward = coalesce((emp->>'initial_carried_forward')::numeric, initial_carried_forward),
                over_45   = coalesce((emp->>'over_45')::boolean, over_45),
                is_frozen = coalesce((emp->>'is_frozen')::boolean, is_frozen),
                hire_date = coalesce(trim(emp->>'hire_date'), hire_date),
                hire_date_current_year = coalesce(nullif(emp->>'hire_date_current_year', ''), hire_date_current_year)::date
            where id = v_target;
            v_updated := v_updated + 1;
        end if;

        if emp ? 'years_data' then
            for yd_key, yd_val in select key, value from jsonb_each(emp->'years_data') loop
                if yd_key ~ '^\d{4}$' then
                    insert into public.years (year) values (yd_key) on conflict (year) do nothing;
                    insert into public.employee_years (employee_id, year, added, deducted)
                    values (v_target, yd_key,
                            coalesce((yd_val->>'added')::numeric, 0),
                            coalesce((yd_val->>'deducted')::numeric, 0))
                    on conflict (employee_id, year)
                        do update set added = excluded.added, deducted = excluded.deducted;
                end if;
            end loop;
        end if;

        if emp ? 'deductions_history' then
            for ded in select value from jsonb_array_elements(emp->'deductions_history') loop
                if not (coalesce((ded->>'days')::numeric, 0) > 0) then continue; end if;
                if nullif(ded->>'id', '') is not null then
                    insert into public.deductions
                        (id, employee_id, year, start_date, end_date, days, note, created_by, created_at)
                    values ((ded->>'id')::bigint, v_target, coalesce(ded->>'year', ''),
                            coalesce(ded->>'start', ''), coalesce(ded->>'end', ''),
                            (ded->>'days')::numeric,
                            nullif(left(trim(coalesce(ded->>'note', '')), 500), ''),
                            ded->>'createdBy', coalesce((ded->>'createdAt')::timestamptz, now()))
                    on conflict (id) do nothing;
                else
                    insert into public.deductions
                        (employee_id, year, start_date, end_date, days, note, created_by, created_at)
                    values (v_target, coalesce(ded->>'year', ''), coalesce(ded->>'start', ''),
                            coalesce(ded->>'end', ''), (ded->>'days')::numeric,
                            nullif(left(trim(coalesce(ded->>'note', '')), 500), ''),
                            ded->>'createdBy', coalesce((ded->>'createdAt')::timestamptz, now()));
                end if;
                v_ded := v_ded + 1;
            end loop;
        end if;
    end loop;

    if v_settings is not null and (v_settings->>'openingBalanceDate') ~ '^\d{4}-\d{2}-\d{2}$' then
        insert into public.settings (key, value)
        values ('openingBalanceDate', v_settings->>'openingBalanceDate')
        on conflict (key) do update set value = excluded.value;
    end if;

    perform setval(pg_get_serial_sequence('public.employees', 'id'),
                   (select coalesce(max(id), 1) from public.employees),
                   (select count(*) > 0 from public.employees));
    perform setval(pg_get_serial_sequence('public.deductions', 'id'),
                   (select coalesce(max(id), 1) from public.deductions),
                   (select count(*) > 0 from public.deductions));

    perform public.log_action(v_role, v_username, 'مزامنة سحابية (استيراد JSON)',
        format('موظفون جدد: %s، تحديثات: %s، خصومات: %s', v_created, v_updated, v_ded));
    return jsonb_build_object('created', v_created, 'updated', v_updated, 'deductions', v_ded);
end;
$$;

-- Update register_deduction to use hire_date_current_year for prorated accrual
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
    v_prev_carry numeric; v_fifo_source text;
    v_curr_year text; v_curr_month int;
    v_months numeric; v_monthly_rate numeric; v_dynamic_added numeric;
    v_hire_date date; v_diff_days int;
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
    select array_agg(year order by cast(year as integer)) into v_years from public.years;
    if v_years is null then raise exception 'لا توجد سنة مالية نشطة لتسجيل الخصم'; end if;
    v_latest := v_years[array_length(v_years, 1)];
    v_has_dates   := (p_start is not null and p_end is not null);
    v_has_unknown := (p_unknown is not null);
    if v_has_dates then
        v_start_year := split_part(p_start, '-', 1);
        if not (v_start_year = any(v_years)) then
            raise exception 'لا توجد سنة مالية نشطة مطابقة لتاريخ البداية (%)', v_start_year;
        end if;
        v_year := v_start_year;
        v_days := public.calculate_deduction_days(p_start, p_end, p_holidays, coalesce(emp.job_title,''));
        if v_days <= 0 then raise exception 'يجب أن يكون عدد أيام الخصم أكبر من صفر'; end if;
        v_retro := ((now() at time zone 'Africa/Tripoli')::date - p_start::date);
        if v_retro > 40 then raise exception 'لا يمكن تسجيل إجازة بتاريخ رجعي يتجاوز 40 يوماً من تاريخ النظام الحالي.'; end if;
        v_start := p_start; v_end := p_end;
    elsif v_has_unknown then
        v_days := p_unknown::numeric;
        if not (v_days > 0) then raise exception 'يرجى إدخال عدد أيام صحيح أكبر من صفر'; end if;
        v_year := v_latest;
    else
        raise exception 'يرجى تحديد تاريخ البداية والنهاية أو عدد أيام الخصم';
    end if;
    -- Dynamic accrual with prorated support for mid-year hires
    v_curr_year := extract(year from now() at time zone 'Africa/Tripoli')::text;
    v_curr_month := extract(month from now() at time zone 'Africa/Tripoli');
    v_monthly_rate := case when emp.over_45 then 3.75 else 2.5 end;
    if v_year < v_curr_year then v_months := 12;
    elsif emp.hire_date_current_year is not null and v_year = v_curr_year then
        v_diff_days := (date_trunc('month', now() at time zone 'Africa/Tripoli') - emp.hire_date_current_year::timestamp);
        v_months := greatest(0, v_diff_days) / 30.0;
    else v_months := greatest(0, v_curr_month - 1); end if;
    v_dynamic_added := round((v_months * v_monthly_rate)::numeric, 1);
    -- Balance check (include dynamic accrual if row doesn't exist yet)
    select coalesce(emp.initial_carried_forward, 0) + coalesce(sum(coalesce(added,0) - coalesce(deducted,0)), 0)
         + case when not exists (select 1 from public.employee_years where employee_id = emp.id and year = v_year)
                then v_dynamic_added else 0 end
      into v_net from public.employee_years where employee_id = emp.id;
    if v_days > v_net then
        raise exception 'فشلت العملية: رصيد الموظف الحالي غير كافٍ لتغطية عدد أيام الخصم المطلوبة.';
    end if;
    -- FIFO source
    select coalesce(emp.initial_carried_forward, 0) + coalesce(sum(coalesce(added,0) - coalesce(deducted,0)), 0)
      into v_prev_carry from public.employee_years where employee_id = emp.id and year < v_year;
    v_prev_carry := greatest(0, v_prev_carry);
    if v_prev_carry <= 0 then v_fifo_source := 'حالي';
    elsif v_days <= v_prev_carry then v_fifo_source := 'سابق';
    else v_fifo_source := 'موزع';
    end if;
    insert into public.employee_years (employee_id, year, added, deducted)
    values (emp.id, v_year, v_dynamic_added, 0)
    on conflict (employee_id, year) do nothing;
    update public.employee_years set deducted = deducted + v_days
        where employee_id = emp.id and year = v_year;
    if coalesce((select coalesce(emp.initial_carried_forward,0) + sum(coalesce(added,0) - coalesce(deducted,0))
           from public.employee_years where employee_id = emp.id), 0) < 0 then
        raise exception 'خطأ داخلي: الرصيف سالب بعد الخصم - تم إلغاء العملية';
    end if;
    insert into public.deductions (employee_id, year, start_date, end_date, days, note, created_by, created_at, deduction_source)
    values (emp.id, v_year, v_start, v_end, v_days, v_note, v_username, now(), v_fifo_source);
    perform public.log_action(v_role, v_username, 'تسجيل خصم إجازة',
        format('تم خصم %s يوم من رصيد %s لسنة %s%s', v_days, emp.name, v_year,
               case when v_has_dates then '' else ' (بدون تاريخ محدد)' end));
    return jsonb_build_object('employee', public.get_employee_json(emp.id));
end;
$$;
