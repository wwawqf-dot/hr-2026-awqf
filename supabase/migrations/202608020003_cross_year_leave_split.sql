-- =====================================================================
--  Migration: Cross-year leave requests (Dec 29 -> Jan 5, and the
--  backdated mirror of it), without a second "active" financial year
--  ---------------------------------------------------------------------
--  Problem: register_deduction required a dated deduction's YEAR to
--  match the single active (latest non-archived) year exactly. Once
--  January arrives and the new year is opened, ANY deduction dated in
--  December — whether it stayed within December or ran into January —
--  was flatly rejected, with no way to record it against the correct
--  historical year short of the lossy "خصم بغير تاريخ" (no-date)
--  fallback.
--
--  Design constraint: the rest of the system (register_deduction's own
--  balance math, the frontend's computeYearlyLedger/computeFifoAudit,
--  add_year's ceiling logic) all assume exactly ONE active year at a
--  time. Making two years simultaneously "active" would ripple through
--  all of that. So instead of widening what "active" means, this keeps
--  a single active year and carves out two narrow, symmetric exceptions
--  to the equality check:
--
--    • forward split  — starts in the active year, ends in the very
--      next one (e.g. Dec 29 active-year -> Jan 5 next-year) — allowed
--      even before that next year has been opened via add_year(). A
--      placeholder employee_years row (added = 0) is created for it;
--      add_year() backfills the real allocation once it actually opens
--      that year (see its on-conflict clause below).
--    • backdated correction — starts (and optionally ends) in the
--      immediately-preceding, now-archived year — bounded by the SAME
--      40-day retroactive window already enforced for every deduction,
--      not a new arbitrary limit.
--
--  Every other year combination is still rejected exactly as before.
--
--  Splitting itself is purely a BOOKKEEPING concern (which year's
--  ledger the days land in, for accurate per-year statements) — it
--  does NOT introduce a second affordability check. The existing
--  employee-wide balance formula (carry-over + all years' movement,
--  minus the active year's stale `added`, plus its fresh dynamic value)
--  already represents "what the employee can spend right now" across
--  every year combined, so it is evaluated once, unchanged, against the
--  full requested day count — avoiding the circular problem of a
--  not-yet-started year having zero accrual of its own to check against.
--
--  A dated deduction landing in a year OTHER than the current active one
--  (the archived prior year, or the not-yet-opened next year) never
--  writes to that row's `added` — only `deducted`. The active year keeps
--  its existing per-deduction dynamic-accrual write, which is harmless
--  noise now that add_year() finalizes the true total when a year
--  actually closes (migration 202608020002).
-- =====================================================================

create extension if not exists pgcrypto;

alter table public.deductions add column if not exists split_group_id uuid default null;
create index if not exists idx_deductions_split_group
    on public.deductions (split_group_id) where split_group_id is not null;

create or replace function public.register_deduction(p_employee_id bigint, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text; v_username text; emp public.employees%rowtype;
    v_has_dates boolean; v_has_unknown boolean;
    v_years text[]; v_latest text; v_prev_year text; v_next_year text;
    v_start_year text; v_end_year text;
    v_year text; v_days numeric; v_start text := ''; v_end text := '';
    v_retro int; v_net numeric; v_note text;
    v_monthly_rate numeric; v_dynamic_added numeric;
    v_official_holidays numeric;
    v_split boolean := false;
    v_year_a text; v_year_b text;
    v_dec31 date; v_jan1 date;
    v_days_a numeric; v_days_b numeric;
    v_holidays_a numeric; v_holidays_b numeric;
    v_split_id uuid;
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
    v_prev_year := (cast(v_latest as integer) - 1)::text;
    v_next_year := (cast(v_latest as integer) + 1)::text;

    v_has_dates   := (p_start is not null and p_end is not null);
    v_has_unknown := (p_unknown is not null);

    if v_has_dates then
        v_start_year := split_part(p_start, '-', 1);
        v_end_year   := split_part(p_end, '-', 1);

        if v_start_year = v_latest and v_end_year = v_latest then
            v_year := v_latest;
        elsif v_start_year = v_latest and v_end_year = v_next_year then
            v_split := true; v_year_a := v_latest; v_year_b := v_next_year;
        elsif v_start_year = v_prev_year and v_end_year = v_prev_year then
            if not exists (select 1 from public.years where year = v_prev_year) then
                raise exception 'لا يمكن تسجيل الإجازة: السنة % غير موجودة في النظام', v_prev_year;
            end if;
            v_year := v_prev_year;
        elsif v_start_year = v_prev_year and v_end_year = v_latest then
            if not exists (select 1 from public.years where year = v_prev_year) then
                raise exception 'لا يمكن تسجيل الإجازة: السنة % غير موجودة في النظام', v_prev_year;
            end if;
            v_split := true; v_year_a := v_prev_year; v_year_b := v_latest;
        else
            raise exception 'لا يمكن تسجيل الإجازة: تاريخ الإجازة يقع خارج السنة المالية النشطة حالياً أو خارج نطاق التصحيح الرجعي المسموح. يرجى إغلاق السنة الحالية أو تفعيل السنة المناسبة.';
        end if;

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
        -- "Today" must be Libya's calendar date, not the database server's — see
        -- register_deduction's original comment (Supabase runs on UTC).
        v_retro := ((now() at time zone 'Africa/Tripoli')::date - p_start::date);
        if v_retro > 40 then
            raise exception 'لا يمكن تسجيل إجازة بتاريخ رجعي يتجاوز 40 يوماً من تاريخ النظام الحالي.';
        end if;
        v_start := p_start; v_end := p_end;

        if v_split then
            v_dec31 := (v_year_a || '-12-31')::date;
            v_jan1  := (v_year_b || '-01-01')::date;

            -- Raw (pre-holiday) leg totals always sum to the full range's raw
            -- total, since Dec 31 / Jan 1 are adjacent calendar days with no
            -- gap or overlap; holidays are then consumed from the first leg
            -- before spilling into the second — a deterministic, if
            -- arbitrary, split (this is a rare edge case).
            declare
                v_leg_a_raw numeric := public.calculate_deduction_days(p_start::date, v_dec31, 0);
                v_leg_b_raw numeric := public.calculate_deduction_days(v_jan1, p_end::date, 0);
            begin
                v_holidays_a := least(p_holidays, v_leg_a_raw);
                v_holidays_b := greatest(0, p_holidays - v_holidays_a);
                v_days_a := greatest(0, v_leg_a_raw - v_holidays_a);
                v_days_b := greatest(0, v_leg_b_raw - v_holidays_b);
            end;

            if exists (select 1 from public.deductions
                        where employee_id = emp.id and year = v_year_a
                        and start_date <> '' and end_date <> ''
                        and start_date::date <= v_dec31 and end_date::date >= v_start::date) then
                raise exception 'يوجد تداخل زمني مع إجازة أخرى مسجلة مسبقاً لهذا الموظف. الأيام محجوزة.';
            end if;
            if exists (select 1 from public.deductions
                        where employee_id = emp.id and year = v_year_b
                        and start_date <> '' and end_date <> ''
                        and start_date::date <= v_end::date and end_date::date >= v_jan1) then
                raise exception 'يوجد تداخل زمني مع إجازة أخرى مسجلة مسبقاً لهذا الموظف. الأيام محجوزة.';
            end if;
        else
            if exists (select 1 from public.deductions
                        where employee_id = emp.id
                        and year = v_year
                        and start_date <> ''
                        and end_date <> ''
                        and start_date::date <= v_end::date
                        and end_date::date >= v_start::date) then
                raise exception 'يوجد تداخل زمني مع إجازة أخرى مسجلة مسبقاً لهذا الموظف. الأيام محجوزة.';
            end if;
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

    -- Dynamic accrual: what the employee has actually earned so far this
    -- (active) year — used for the balance check regardless of which
    -- year(s) the deduction itself will land in.
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

    if v_split then
        v_split_id := gen_random_uuid();

        if v_year_a = v_latest then
            insert into public.employee_years (employee_id, year, added, deducted)
            values (emp.id, v_year_a, v_dynamic_added, 0)
            on conflict (employee_id, year) do update set added = v_dynamic_added;
        else
            -- Archived prior year or not-yet-opened next year: never touch
            -- `added`, only `deducted`.
            insert into public.employee_years (employee_id, year, added, deducted)
            values (emp.id, v_year_a, 0, 0)
            on conflict (employee_id, year) do nothing;
        end if;
        update public.employee_years set deducted = deducted + v_days_a
            where employee_id = emp.id and year = v_year_a;

        if v_year_b = v_latest then
            insert into public.employee_years (employee_id, year, added, deducted)
            values (emp.id, v_year_b, v_dynamic_added, 0)
            on conflict (employee_id, year) do update set added = v_dynamic_added;
        else
            insert into public.employee_years (employee_id, year, added, deducted)
            values (emp.id, v_year_b, 0, 0)
            on conflict (employee_id, year) do nothing;
        end if;
        update public.employee_years set deducted = deducted + v_days_b
            where employee_id = emp.id and year = v_year_b;

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

        insert into public.deductions
            (employee_id, year, start_date, end_date, days, note, created_by, created_at, split_group_id, official_holidays)
        values
            (emp.id, v_year_a, v_start, v_dec31::text, v_days_a, v_note, v_username, now(), v_split_id, v_holidays_a),
            (emp.id, v_year_b, v_jan1::text, v_end, v_days_b, v_note, v_username, now(), v_split_id, v_holidays_b);

        perform public.log_action(v_role, v_username, 'تسجيل خصم إجازة (منشطر بين سنتين)',
            format('تم خصم %s يوم من رصيد %s — %s يوم لسنة %s و%s يوم لسنة %s',
                   v_days, emp.name, v_days_a, v_year_a, v_days_b, v_year_b));
    else
        if v_year = v_latest then
            insert into public.employee_years (employee_id, year, added, deducted)
            values (emp.id, v_year, v_dynamic_added, 0)
            on conflict (employee_id, year) do update set added = v_dynamic_added;
        else
            -- Backdated into an archived year: that year's total was already
            -- finalized by add_year() when it closed — never overwrite it.
            insert into public.employee_years (employee_id, year, added, deducted)
            values (emp.id, v_year, 0, 0)
            on conflict (employee_id, year) do nothing;
        end if;
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
    end if;

    return jsonb_build_object('employee', public.get_employee_json(emp.id));
end;
$$;

-- Deleting either leg of a split request removes both together — they are
-- one logical leave, and reversing only half would silently leave the
-- other year's ledger permanently short by whatever was double-counted.
create or replace function public.delete_deduction(p_deduction_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_username text; d public.deductions%rowtype;
    v_total numeric := 0; sib record;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    select * into d from public.deductions where id = p_deduction_id for update;
    if not found then raise exception 'هذا الخصم غير موجود'; end if;

    if d.split_group_id is not null then
        for sib in select * from public.deductions where split_group_id = d.split_group_id for update loop
            update public.employee_years set deducted = greatest(0, deducted - sib.days)
                where employee_id = sib.employee_id and year = sib.year;
            v_total := v_total + sib.days;
        end loop;
        delete from public.deductions where split_group_id = d.split_group_id;
    else
        update public.employee_years set deducted = greatest(0, deducted - d.days)
            where employee_id = d.employee_id and year = d.year;
        delete from public.deductions where id = d.id;
        v_total := d.days;
    end if;

    perform public.log_action(v_role, v_username, 'حذف خصم إجازة',
        format('تم حذف خصم %s يوم', v_total));
    return jsonb_build_object('employee', public.get_employee_json(d.employee_id));
end;
$$;

-- Backfill the real allocation into a placeholder row (added = 0) that a
-- forward-split deduction may have created for this year before it was
-- ever officially opened. A row that already has a real allocation is left
-- untouched.
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

    for emp in
        select e.id, e.over_45, e.hire_date_current_year, e.is_unpaid_leave
        from public.employees e where e.is_archived = false
    loop
        v_monthly_rate := case when emp.over_45 then 3.75 else 2.5 end;
        for v_closing_year in
            select y.year from public.years y
            where y.is_archived = false and cast(y.year as integer) < cast(v_year as integer)
        loop
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
    on conflict (employee_id, year) do update
        set added = excluded.added
        where public.employee_years.added = 0;

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

-- Expose splitGroupId so the frontend can, if it chooses to, visually group
-- the two legs of a cross-year request.
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
                       'officialHolidays', d.official_holidays,
                       'splitGroupId', d.split_group_id
                   ) order by d.id)
            from public.deductions d where d.employee_id = e.id
        ), '[]'::jsonb),
        'createdAt', e.created_at
    )
    from public.employees e where e.id = p_id;
$$;
