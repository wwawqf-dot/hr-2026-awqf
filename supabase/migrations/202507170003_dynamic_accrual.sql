-- =====================================================================
--  Migration: Dynamic monthly accrual — remove static 30/45
--  Replaces hardcoded 30/45 in register_deduction with calculated
--  dynamic accrual: months_elapsed × monthly_rate
-- =====================================================================

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
    v_months int; v_monthly_rate numeric; v_dynamic_added numeric;
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
        v_days := public.calculate_deduction_days(p_start, p_end, p_holidays, coalesce(emp.is_memorizer, false));
        if v_days <= 0 then raise exception 'يجب أن يكون عدد أيام الخصم أكبر من صفر'; end if;
        v_retro := ((now() at time zone 'Africa/Tripoli')::date - p_start::date);
        if v_retro > 40 then
            raise exception 'لا يمكن تسجيل إجازة بتاريخ رجعي يتجاوز 40 يوماً من تاريخ النظام الحالي.';
        end if;
        v_start := p_start; v_end := p_end;
    elsif v_has_unknown then
        v_days := p_unknown::numeric;
        if not (v_days > 0) then raise exception 'يرجى إدخال عدد أيام صحيح أكبر من صفر'; end if;
        v_year := v_latest;
    else
        raise exception 'يرجى تحديد تاريخ البداية والنهاية أو عدد أيام الخصم';
    end if;

    -- Dynamic accrual: months_elapsed × monthly_rate (no hardcoded 30/45)
    v_curr_year := extract(year from now() at time zone 'Africa/Tripoli')::text;
    v_curr_month := extract(month from now() at time zone 'Africa/Tripoli');
    v_monthly_rate := case when emp.over_45 then 3.75 else 2.5 end;
    if v_year < v_curr_year then
        v_months := 12;
    else
        v_months := greatest(0, v_curr_month - 1);
    end if;
    v_dynamic_added := round((v_months * v_monthly_rate)::numeric, 1);

    -- Insufficient-balance check: include dynamic accrual if no row exists yet
    select coalesce(emp.initial_carried_forward, 0)
         + coalesce(sum(coalesce(added,0) - coalesce(deducted,0)), 0)
         + case when not exists (
                select 1 from public.employee_years
                where employee_id = emp.id and year = v_year
           ) then v_dynamic_added else 0 end
      into v_net
      from public.employee_years where employee_id = emp.id;
    if v_days > v_net then
        raise exception 'فشلت العملية: رصيد الموظف الحالي غير كافٍ لتغطية عدد أيام الخصم المطلوبة.';
    end if;

    -- FIFO source
    select coalesce(emp.initial_carried_forward, 0)
         + coalesce(sum(coalesce(added,0) - coalesce(deducted,0)), 0)
      into v_prev_carry
      from public.employee_years
     where employee_id = emp.id and year < v_year;
    v_prev_carry := greatest(0, v_prev_carry);

    if v_prev_carry <= 0 then v_fifo_source := 'حالي';
    elsif v_days <= v_prev_carry then v_fifo_source := 'سابق';
    else v_fifo_source := 'موزع';
    end if;

    -- Insert/update with dynamic added value
    insert into public.employee_years (employee_id, year, added, deducted)
    values (emp.id, v_year, v_dynamic_added, 0)
    on conflict (employee_id, year) do nothing;

    update public.employee_years set deducted = deducted + v_days
        where employee_id = emp.id and year = v_year;

    if coalesce((select coalesce(emp.initial_carried_forward,0)
                  + sum(coalesce(added,0) - coalesce(deducted,0))
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
