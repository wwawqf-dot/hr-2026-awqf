-- =====================================================================
--  Migration: Strict financial-year Time Guard for register_deduction
--  ---------------------------------------------------------------------
--  Problem: register_deduction accepted a dated deduction whose start_date
--  fell in ANY year that still had a row in public.years — not
--  necessarily the currently active (latest, non-archived) one. That
--  let a deduction "bleed" into a closed prior year purely because that
--  year's row hadn't been archived yet. The years lookup also never
--  filtered is_archived, so an archived year could still be selected as
--  the active year or as a valid target.
--
--  Fix: the active year is strictly the latest NON-ARCHIVED year, and a
--  dated deduction's start-date year must match it exactly. This is a
--  server-side backstop for the same rule now enforced in the
--  DeductionModal UI (Save is disabled client-side first) — the backend
--  must never trust the frontend alone for a business rule like this.
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
    p_start text := nullif(p_payload->>'start', '');
    p_end   text := nullif(p_payload->>'end', '');
    p_holidays numeric := coalesce((p_payload->>'customHolidays')::numeric, 0);
    p_unknown  text := nullif(trim(coalesce(p_payload->>'unknownDays','')), '');
begin
    if auth.uid() is null then raise exception 'غير مصرح'; end if;
    select role, coalesce(username, '') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is null then raise exception 'الحساب غير مُهيأ'; end if;

    -- Pessimistic row lock: prevents two concurrent deductions from both
    -- passing the insufficient-balance check before either one commits.
    select * into emp from public.employees where id = p_employee_id for update;
    if not found then raise exception 'الموظف غير موجود'; end if;
    if emp.is_unpaid_leave then
        raise exception 'الموظف في إجازة بدون مرتب - لا يمكن تسجيل خصومات';
    end if;

    v_note := nullif(left(trim(coalesce(p_payload->>'note','')), 500), '');

    select array_agg(year order by cast(year as integer)) into v_years
        from public.years where coalesce(is_archived, false) = false;
    if v_years is null then raise exception 'لا توجد سنة مالية نشطة لتسجيل الخصم'; end if;
    v_latest := v_years[array_length(v_years, 1)];

    v_has_dates   := (p_start is not null and p_end is not null);
    v_has_unknown := (p_unknown is not null);

    if v_has_dates then
        v_start_year := split_part(p_start, '-', 1);
        -- Strict Time Guard: the deduction's year must be exactly the
        -- active (latest, non-archived) financial year — not merely any
        -- year that happens to still have a row in public.years.
        if v_start_year is distinct from v_latest then
            raise exception 'لا يمكن تسجيل الإجازة: تاريخ الإجازة يقع خارج السنة المالية النشطة حالياً. يرجى إغلاق السنة الحالية أو تفعيل السنة المناسبة.';
        end if;
        v_year := v_start_year;
        v_days := public.calculate_deduction_days(p_start, p_end, p_holidays);
        if v_days <= 0 then
            raise exception 'يجب أن يكون عدد أيام الخصم أكبر من صفر';
        end if;
        -- "Today" must be Libya's calendar date, not the database server's.
        -- Supabase runs on UTC, so between 00:00 and 02:00 Libya time
        -- `current_date` is still yesterday — silently widening the 40-day
        -- window to 41 during those hours and disagreeing with the
        -- frontend's Africa/Tripoli check.
        v_retro := ((now() at time zone 'Africa/Tripoli')::date - p_start::date);
        if v_retro > 40 then
            raise exception 'لا يمكن تسجيل إجازة بتاريخ رجعي يتجاوز 40 يوماً من تاريخ النظام الحالي.';
        end if;
        v_start := p_start; v_end := p_end;
    elsif v_has_unknown then
        v_days := p_unknown::numeric;
        if not (v_days > 0) then
            raise exception 'يرجى إدخال عدد أيام صحيح أكبر من صفر';
        end if;
        v_year := v_latest;
    else
        raise exception 'يرجى تحديد تاريخ البداية والنهاية أو عدد أيام الخصم';
    end if;

    -- Insufficient-balance protection (computed BEFORE the new year row is
    -- inserted, matching the original Express behavior exactly).
    select coalesce(emp.initial_carried_forward, 0)
         + coalesce(sum(coalesce(added,0) - coalesce(deducted,0)), 0)
      into v_net
      from public.employee_years where employee_id = emp.id;
    if v_days > v_net then
        raise exception 'فشلت العملية: رصيد الموظف الحالي غير كافٍ لتغطية عدد أيام الخصم المطلوبة.';
    end if;

    insert into public.employee_years (employee_id, year, added, deducted)
    values (emp.id, v_year, case when emp.over_45 then 45 else 30 end, 0)
    on conflict (employee_id, year) do nothing;

    update public.employee_years set deducted = deducted + v_days
        where employee_id = emp.id and year = v_year;

    -- Post-update sanity check (defence in depth against race / logic bugs).
    if coalesce((select coalesce(emp.initial_carried_forward,0)
                  + sum(coalesce(added,0) - coalesce(deducted,0))
             from public.employee_years where employee_id = emp.id), 0) < 0 then
        raise exception 'خطأ داخلي: الرصيف سالب بعد الخصم - تم إلغاء العملية';
    end if;

    insert into public.deductions (employee_id, year, start_date, end_date, days, note, created_by, created_at)
    values (emp.id, v_year, v_start, v_end, v_days, v_note, v_username, now());

    perform public.log_action(v_role, v_username, 'تسجيل خصم إجازة',
        format('تم خصم %s يوم من رصيد %s لسنة %s%s', v_days, emp.name, v_year,
               case when v_has_dates then '' else ' (بدون تاريخ محدد)' end));

    return jsonb_build_object('employee', public.get_employee_json(emp.id));
end;
$$;
