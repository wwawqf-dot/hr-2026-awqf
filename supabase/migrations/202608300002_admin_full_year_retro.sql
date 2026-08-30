-- =====================================================================
--  Full-year retroactive leave for Administrators (مدير النظام)
--  ---------------------------------------------------------------------
--  Administrators (role = 'admin', which includes the Super Admin) may
--  register a dated deduction at ANY point within the current financial
--  year — including a full year back when we are near the end of the
--  year. The 40-day retroactive limit now applies ONLY to data_entry.
-- =====================================================================

create or replace function public.register_deduction(p_employee_id bigint, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text; v_username text; v_email text; emp public.employees%rowtype;
    v_has_dates boolean; v_has_unknown boolean;
    v_years text[]; v_latest text; v_start_year text;
    v_year text; v_days numeric; v_start text := ''; v_end text := '';
    v_retro int; v_net numeric; v_note text;
    v_year_default numeric; v_year_start date;
    v_today date;
    v_can_full_year boolean := false;
    p_start text := nullif(p_payload->>'start', '');
    p_end   text := nullif(p_payload->>'end', '');
    p_holidays numeric := coalesce((p_payload->>'customHolidays')::numeric, 0);
    p_unknown  text := nullif(trim(coalesce(p_payload->>'unknownDays','')), '');
begin
    if auth.uid() is null then raise exception 'غير مصرح'; end if;
    select role, coalesce(username, ''), coalesce(email, '')
        into v_role, v_username, v_email
        from public.profiles where id = auth.uid();
    if v_role is null then raise exception 'الحساب غير مُهيأ'; end if;
    if v_role not in ('admin', 'data_entry') then
        raise exception 'هذه العملية تتطلب صلاحية مُدخل بيانات على الأقل';
    end if;

    -- Administrators (مدير النظام), which includes the Super Admin, may
    -- record leave at any point in the financial year. data_entry stays
    -- bound to the 40-day retroactive window.
    v_can_full_year := (v_role = 'admin');

    -- Pessimistic row lock: prevents two concurrent deductions from both
    -- passing the insufficient-balance check before either one commits.
    select * into emp from public.employees where id = p_employee_id for update;
    if not found then raise exception 'الموظف غير موجود'; end if;
    if emp.is_archived then raise exception 'لا يمكن تسجيل خصم على موظف محذوف (مؤرشف)'; end if;
    v_note := nullif(left(trim(coalesce(p_payload->>'note','')), 500), '');

    select array_agg(year order by cast(year as integer)) into v_years
        from public.years where coalesce(is_archived, false) = false;
    if v_years is null then raise exception 'لا توجد سنة مالية نشطة لتسجيل الخصم'; end if;
    v_latest := v_years[array_length(v_years, 1)];

    -- "Today" must be Libya's calendar date, not the database server's.
    v_today := (now() at time zone 'Africa/Tripoli')::date;

    v_has_dates   := (p_start is not null and p_end is not null);
    v_has_unknown := (p_unknown is not null);

    if v_has_dates then
        v_start_year := split_part(p_start, '-', 1);

        if v_start_year is distinct from v_latest then
            -- A leave that STARTED in an earlier financial year (the
            -- December-into-January case) stays recordable as long as
            -- that year is still active; the retro bound below is what
            -- actually limits it.
            if not exists (select 1 from public.years
                            where year = v_start_year
                              and coalesce(is_archived, false) = false) then
                raise exception 'لا يمكن تسجيل الإجازة: تاريخ الإجازة يقع خارج السنوات المالية النشطة. يرجى استعادة السنة المناسبة من الأرشيف أولاً.';
            end if;
            if v_start_year::int > v_latest::int then
                raise exception 'لا يمكن تسجيل إجازة في سنة مالية لاحقة للسنة النشطة (%).', v_latest;
            end if;
        end if;

        v_year := v_start_year;

        if p_holidays < 0 then
            raise exception 'لا يمكن أن يكون عدد العطلات الرسمية سالباً';
        end if;

        -- (10) Explicit forward bound. The retro check below only ever
        -- looked backwards, so a start date arbitrarily far in the future
        -- passed silently while still spending the balance today.
        if p_start::date > make_date(extract(year from v_today)::int, 12, 31) then
            raise exception 'لا يمكن تسجيل إجازة بتاريخ يتجاوز نهاية السنة الحالية (%).',
                to_char(make_date(extract(year from v_today)::int, 12, 31), 'YYYY-MM-DD');
        end if;

        v_days := public.calculate_deduction_days(p_start::date, p_end::date, p_holidays);
        if v_days <= 0 then
            raise exception 'يجب أن يكون عدد أيام الخصم أكبر من صفر';
        end if;
        if v_days > 366 then
            raise exception 'لا يمكن تسجيل خصم يتجاوز 366 يوماً في عملية واحدة';
        end if;

        -- Retroactive bound. An Administrator (مدير النظام) — which
        -- includes the Super Admin — may record a dated leave at ANY
        -- point back to the start of the financial year it belongs to
        -- (even a full year back near the end of the year). Only
        -- data_entry remains limited to the 40-day window.
        v_retro := (v_today - p_start::date);
        if v_can_full_year then
            v_year_start := make_date(cast(v_year as int), 1, 1);
            if p_start::date < v_year_start then
                raise exception 'لا يمكن تسجيل إجازة قبل بداية السنة المالية (%).',
                    to_char(v_year_start, 'YYYY-MM-DD');
            end if;
        elsif v_retro > 40 then
            raise exception 'لا يمكن تسجيل إجازة بتاريخ رجعي يتجاوز 40 يوماً من تاريخ النظام الحالي.';
        end if;
        v_start := p_start; v_end := p_end;

        if exists (select 1 from public.deductions
                    where employee_id = emp.id and start_date = v_start and end_date = v_end) then
            raise exception 'هذا الخصم مسجل مسبقاً لهذا التاريخ';
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

    -- Insufficient-balance protection, measured against exactly what the
    -- UI shows: the granted allocation minus what has been spent. Under
    -- manual allocation the stored grant IS the entitlement, so there is
    -- no longer a gap between "allocated" and "earned so far" to police.
    -- Bypassed for unpaid leave employees (their balance is 0 by design).
    -- (17) Honour the allocation the admin configured for that year
    -- instead of assuming 30.
    select coalesce(default_days, 30) into v_year_default
        from public.years where year = v_year;

    insert into public.employee_years (employee_id, year, added, deducted)
    values (emp.id, v_year,
            public.year_allocation(v_year, emp.over_45, emp.hire_date_current_year,
                                   coalesce(v_year_default, 30)), 0)
    on conflict (employee_id, year) do nothing;

    -- The row above must exist BEFORE the balance is measured.
    if not emp.is_unpaid_leave then
        v_net := public.employee_net_balance(emp.id);
        if v_days > v_net then
            raise exception 'فشلت العملية: رصيد الموظف الحالي غير كافٍ لتغطية عدد أيام الخصم المطلوبة. الرصيد المتاح: % يوم.', v_net;
        end if;
    end if;

    update public.employee_years set deducted = deducted + v_days
        where employee_id = emp.id and year = v_year;

    insert into public.deductions (employee_id, year, start_date, end_date, days, note, created_by, created_at)
    values (emp.id, v_year, v_start, v_end, v_days, v_note, v_username, now());

    -- Post-update sanity check (defence in depth against race / logic
    -- bugs), on the same basis as the pre-check above.
    if not emp.is_unpaid_leave then
        if public.employee_net_balance(emp.id) < 0 then
            raise exception 'خطأ داخلي: الرصيد أصبح سالباً بعد الخصم — تم إلغاء العملية';
        end if;
    end if;

    perform public.log_action(v_role, v_username, 'تسجيل خصم إجازة',
        format('تم خصم %s يوم من رصيد %s لسنة %s%s', v_days, emp.name, v_year,
               case when v_has_dates then '' else ' (بدون تاريخ محدد)' end));

    return jsonb_build_object('employee', public.get_employee_json(emp.id));
end;
$$;
