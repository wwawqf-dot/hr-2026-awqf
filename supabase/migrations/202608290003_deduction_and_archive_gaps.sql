-- =====================================================================
--  Three defects found by tracing the write paths end to end
--  -------------------------------------------------------------------
--  (1) A DEDUCTION WAS MEASURED AGAINST A BALANCE MISSING ITS OWN YEAR.
--      register_deduction() created the employee-year row AFTER running
--      the insufficient-balance check, so whenever that row did not yet
--      exist the year's whole grant was absent from the figure the check
--      used. The employee was told "الرصيد المتاح: 0" for days they held.
--      Reachable in January: recording a December leave for a year the
--      release pass does not create rows for.
--
--  (2) AN ARCHIVED YEAR WAS SPENT BUT NEVER TOPPED UP. employee_net_balance()
--      counts every employee_years row, archived or not — but the release
--      pass skipped archived years in all four of its conditions. Since
--      archive_year() is reversible hiding rather than a close, a year
--      hidden across 1 July or 31 December kept being deducted from while
--      its allocation stayed frozen. The employee went quietly short.
--
--  (3) A YEAR HIDDEN TOO LONG CAME BACK SHORT. The release pass reaches
--      one year back. A year archived for longer than that returns with
--      whatever it was frozen at, and nothing would ever settle it.
--      restore_year() now settles on the way in.
--
--  All three are upward-only. Nothing here can lower a balance.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. MEASURE THE BALANCE AFTER THE YEAR'S ROW EXISTS
-- ---------------------------------------------------------------------
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
    v_year_default numeric;
    v_today date;
    p_start text := nullif(p_payload->>'start', '');
    p_end   text := nullif(p_payload->>'end', '');
    p_holidays numeric := coalesce((p_payload->>'customHolidays')::numeric, 0);
    p_unknown  text := nullif(trim(coalesce(p_payload->>'unknownDays','')), '');
begin
    if auth.uid() is null then raise exception 'غير مصرح'; end if;
    select role, coalesce(username, '') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is null then raise exception 'الحساب غير مُهيأ'; end if;
    if v_role not in ('admin', 'data_entry') then
        raise exception 'هذه العملية تتطلب صلاحية مُدخل بيانات على الأقل';
    end if;

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
            -- that year is still active; the 40-day window below is what
            -- actually bounds it. Previously this branch rejected every
            -- such leave the moment a new year was opened, which made
            -- late-December leave impossible to record every January.
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

        v_retro := (v_today - p_start::date);
        if v_retro > 40 then
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

    -- The row above must exist BEFORE the balance is measured. It used to
    -- be created afterwards, so an employee with no row for the year --
    -- restored from the archive, or recording a December leave in January
    -- for a year the release pass does not create rows for -- had that
    -- year's entire grant missing from v_net. The deduction was refused
    -- with "الرصيد المتاح: 0" for days the employee actually held. If the
    -- deduction is rejected below, the whole transaction rolls back and
    -- this row goes with it.
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


-- ---------------------------------------------------------------------
-- 2. THE RELEASE PASS FOLLOWS THE SAME YEARS THE BALANCE COUNTS
-- ---------------------------------------------------------------------
create or replace function public.grant_due_installments()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_today    date := (now() at time zone 'Africa/Tripoli')::date;
    v_cur_year text := to_char(v_today, 'YYYY');
    v_from     text := (extract(year from v_today)::int - 1)::text;
    v_created  int  := 0;
    v_granted  int  := 0;
begin
    -- Read-only probe first. This function runs on every page load for
    -- every signed-in user, and on all but two days of the year there is
    -- nothing to release. Taking write locks to discover that is what
    -- turns eight o'clock on a Sunday into row contention.
    if not exists (
        select 1
          from public.employee_years ey
          join public.employees e on e.id = ey.employee_id
          join public.years     y on y.year = ey.year
         where e.is_archived = false
           -- Deliberately NOT filtered on y.is_archived. employee_net_balance()
           -- counts an archived year's figures like any other, so freezing its
           -- allocation while still spending against it leaves the employee
           -- silently short. A year hidden across 1 July or 31 December is the
           -- exact case: archive_year() is reversible hiding, not a close, and
           -- the balance never stopped counting it. Upward-only, and bounded to
           -- one year back, so this can still never restate settled history.
           and ey.year ~ '^\d{4}$'
           and ey.year >= v_from
           and public.allocation_due(ey.year, e.over_45, e.hire_date_current_year,
                                     coalesce(y.default_days, 30), null) > ey.added
    ) and not exists (
        select 1
          from public.employees e
          cross join public.years y
         where e.is_archived = false
           and coalesce(y.is_archived, false) = false
           and y.year ~ '^\d{4}$'
           and y.year >= v_cur_year
           and not exists (select 1 from public.employee_years ey
                            where ey.employee_id = e.id and ey.year = y.year)
    ) then
        return jsonb_build_object('created', 0, 'granted', 0);
    end if;

    -- Missing rows are created for the CURRENT year onward only. Minting
    -- a row for a year already closed would invent history for someone
    -- who was not on the payroll to earn it.
    insert into public.employee_years (employee_id, year, added, deducted)
    select e.id, y.year,
           public.allocation_due(y.year, e.over_45, e.hire_date_current_year,
                                 coalesce(y.default_days, 30), null), 0
      from public.employees e
      cross join public.years y
     where e.is_archived = false
       and coalesce(y.is_archived, false) = false
       and y.year ~ '^\d{4}$'
       and y.year >= v_cur_year
       and not exists (select 1 from public.employee_years ey
                        where ey.employee_id = e.id and ey.year = y.year)
    on conflict (employee_id, year) do nothing;
    get diagnostics v_created = row_count;

    -- The top-up reaches back one year, and is upward-only everywhere —
    -- which is exactly what makes reaching back safe.
    with earned as (
        select ey.id,
               ey.added as stored,
               public.allocation_due(ey.year, e.over_45, e.hire_date_current_year,
                                     coalesce(y.default_days, 30), null) as owed
          from public.employee_years ey
          join public.employees e on e.id = ey.employee_id
          join public.years     y on y.year = ey.year
         where e.is_archived = false
           -- Deliberately NOT filtered on y.is_archived. employee_net_balance()
           -- counts an archived year's figures like any other, so freezing its
           -- allocation while still spending against it leaves the employee
           -- silently short. A year hidden across 1 July or 31 December is the
           -- exact case: archive_year() is reversible hiding, not a close, and
           -- the balance never stopped counting it. Upward-only, and bounded to
           -- one year back, so this can still never restate settled history.
           and ey.year ~ '^\d{4}$'
           and ey.year >= v_from
    ),
    applied as (
        update public.employee_years ey
           set added = d.owed
          from earned d
         where ey.id = d.id
           and d.owed > d.stored
        returning 1
    )
    select count(*) into v_granted from applied;

    return jsonb_build_object('created', v_created, 'granted', v_granted);
end;
$$;


-- ---------------------------------------------------------------------
-- 3. RESTORING A YEAR SETTLES IT
-- ---------------------------------------------------------------------
create or replace function public.restore_year(p_year text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_username text; v_year text;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then raise exception 'هذه العملية مقصورة على المدير'; end if;
    v_year := trim(coalesce(p_year, ''));
    if not exists (select 1 from public.years where year = v_year and is_archived = true) then
        raise exception 'هذه السنة ليست في الأرشيف';
    end if;
    update public.years set is_archived = false where year = v_year;

    -- A year can be hidden before a release point and brought back after
    -- it. The release pass only reaches one year back, so a year hidden
    -- for longer would return permanently short. Settle it on the way in,
    -- as of today and upward only.
    update public.employee_years ey
       set added = public.allocation_due(ey.year, e.over_45,
                       e.hire_date_current_year, coalesce(y.default_days, 30), null)
      from public.employees e, public.years y
     where ey.employee_id = e.id
       and y.year = ey.year
       and ey.year = v_year
       and e.is_archived = false
       and public.allocation_due(ey.year, e.over_45, e.hire_date_current_year,
               coalesce(y.default_days, 30), null) > ey.added;
    perform public.log_action(v_role, v_username, 'استعادة سنة مالية من الأرشيف', format('السنة: %s', v_year));
    return jsonb_build_object('years',
        coalesce((select jsonb_agg(year order by cast(year as integer))
                  from public.years where is_archived = false), '[]'::jsonb));
end;
$$;


-- ---------------------------------------------------------------------
-- 4. SETTLE ANYTHING THE ARCHIVED-YEAR GAP LEFT SHORT
-- ---------------------------------------------------------------------
do $$
declare r jsonb;
begin
    r := public.grant_due_installments();
    raise notice 'archived-year settle: created=% granted=%', r->>'created', r->>'granted';
end;
$$;
