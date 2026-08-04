-- =====================================================================
--  Security & data-integrity hardening
--  ---------------------------------------------------------------------
--  Closes the findings of the 2026-08-04 code review, items 2..17.
--  (Item 1 — the leaked service_role key — is a dashboard rotation and is
--   intentionally NOT touched here.)
--
--   2  archive RPCs leaked every employee (incl. archived) to any login
--   3  invite codes let a 'viewer' promote itself to 'data_entry'
--   4  super-admin protection bypassable by a direct PATCH on profiles
--   5  activity_logs insertable (and forgeable) by any logged-in user
--   6  server-side balance guard used the stored yearly allocation
--      instead of the days actually accrued so far
--   7  add_year() accepted a year older than the newest one and rewrote
--      every employee's carried-forward balance
--   8  sync_employees() left employee_years.deducted out of sync with
--      the deduction register, permanently and silently
--   9  a leave that started in December became unrecordable the moment
--      the new financial year was opened
--  10  no explicit bound on how far in the future a leave could start
--  11  profiles.username had no uniqueness — an attacker could squat the
--      admin's name and break resolve_login()
--  12  resolve_login() let anonymous callers enumerate usernames
--  13  create_user() password floor raised, failures surfaced clearly
--  15  invite codes generated in the browser with Math.random()
--  16  delete_deduction() masked counter drift with greatest(0, ...)
--  17  register_deduction() ignored the year's configured default days
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. SCHEMA ADDITIONS
-- ---------------------------------------------------------------------

-- (17) The per-year default allocation was only ever a parameter of
-- add_year(); nothing persisted it, so any later code path had to guess
-- "30". Store it on the year itself.
alter table public.years
    add column if not exists default_days numeric not null default 30;

-- (3) Bind a redeemed invite code to the account that redeemed it.
alter table public.invite_codes
    add column if not exists used_by uuid references auth.users(id) on delete set null;
alter table public.invite_codes
    add column if not exists used_at timestamptz;

-- (5) Real attribution for the activity trail — an email string alone is
-- not evidence of who acted.
alter table public.activity_logs
    add column if not exists user_id uuid;


-- ---------------------------------------------------------------------
-- 1. (6) ACCRUAL-AWARE BALANCE — the server-side guard, in SQL
-- ---------------------------------------------------------------------
-- Faithful port of the frontend's getAccruedDays() (libyaTime.js) so the
-- database enforces exactly what the UI displays. Previously the RPC
-- compared against employee_years.added (the FULL annual 30/45), while
-- the UI compared against the days accrued so far — meaning a direct RPC
-- call could spend months that had not been earned yet.
create or replace function public.accrued_days(
    p_year                  text,
    p_over_45               boolean default false,
    p_hire_date_current_year date   default null,
    p_now                   timestamptz default now()
) returns numeric
language plpgsql
stable
as $$
declare
    v_rate       numeric := case when p_over_45 then 3.75 else 2.5 end;
    v_today      date    := (p_now at time zone 'Africa/Tripoli')::date;
    v_cur_year   int     := extract(year  from v_today)::int;
    v_cur_month  int     := extract(month from v_today)::int;
    v_target     int;
    v_cutoff     int;
    v_hire_month int;
    v_hire_day   int;
    v_first      int;
    v_months     int;
begin
    if p_year is null or p_year !~ '^\d{4}$' then return 0; end if;
    v_target := p_year::int;

    -- 15th-day hire rule, applied only while the hire year IS the year
    -- being computed; after a rollover the employee accrues normally.
    if p_hire_date_current_year is not null
       and v_target = v_cur_year
       and extract(year from p_hire_date_current_year)::int = v_target
    then
        v_cutoff     := v_cur_month - 1;   -- the running month never counts
        v_hire_month := extract(month from p_hire_date_current_year)::int;
        v_hire_day   := extract(day   from p_hire_date_current_year)::int;
        if v_hire_month > v_cutoff then return 0; end if;
        v_first := case when v_hire_day > 15 then v_hire_month + 1 else v_hire_month end;
        if v_first > v_cutoff then return 0; end if;
        v_months := v_cutoff - v_first + 1;
        return round(v_months * v_rate, 2);
    end if;

    return round(
        case
            when v_target < v_cur_year then 12
            when v_target > v_cur_year then 0
            else greatest(0, v_cur_month - 1)
        end * v_rate, 2);
end;
$$;

-- Mirror of computeNetBalance() in DeductionModal.jsx: past years read
-- their stored added/deducted verbatim; the CURRENT calendar year counts
-- only what has actually accrued.
create or replace function public.employee_net_balance(p_employee_id bigint)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    emp          public.employees%rowtype;
    v_cur_year   text;
    v_balance    numeric;
    v_has_current boolean := false;
    r            record;
begin
    select * into emp from public.employees where id = p_employee_id;
    if not found then return 0; end if;

    v_cur_year := to_char((now() at time zone 'Africa/Tripoli')::date, 'YYYY');
    v_balance  := coalesce(emp.initial_carried_forward, 0);

    for r in select year,
                    coalesce(added, 0)    as added,
                    coalesce(deducted, 0) as deducted
               from public.employee_years
              where employee_id = p_employee_id
    loop
        if r.year = v_cur_year then
            v_has_current := true;
            -- Unpaid leave freezes the current year's accrual at 0 but
            -- keeps history intact.
            if emp.is_unpaid_leave then
                v_balance := v_balance - r.deducted;
            else
                v_balance := v_balance
                           + public.accrued_days(v_cur_year, emp.over_45, emp.hire_date_current_year)
                           - r.deducted;
            end if;
        else
            v_balance := v_balance + r.added - r.deducted;
        end if;
    end loop;

    if not v_has_current and not emp.is_unpaid_leave then
        v_balance := v_balance
                   + public.accrued_days(v_cur_year, emp.over_45, emp.hire_date_current_year);
    end if;

    return round(v_balance, 2);
end;
$$;


-- ---------------------------------------------------------------------
-- 2. (8/16) COUNTER RECONCILIATION — employee_years.deducted is, by
--    design, exactly the sum of that employee-year's deduction rows.
--    Every writer maintains that invariant; only sync_employees could
--    break it. Make the invariant enforceable instead of assumed.
-- ---------------------------------------------------------------------
create or replace function public.reconcile_counters(p_employee_ids bigint[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_fixed int := 0;
begin
    -- A deduction whose (employee, year) has no counter row at all would
    -- otherwise be invisible to the recompute below. The allocation is
    -- filled in the same way add_year() would have, so the restored row
    -- neither invents nor withholds entitlement.
    insert into public.employee_years (employee_id, year, added, deducted)
    select distinct d.employee_id, d.year,
           case when e.over_45 then 45 else coalesce(y.default_days, 30) end, 0
      from public.deductions d
      join public.employees e on e.id = d.employee_id
      join public.years     y on y.year = d.year
     where (p_employee_ids is null or d.employee_id = any(p_employee_ids))
       and d.year ~ '^\d{4}$'
       and not exists (
           select 1 from public.employee_years ey
            where ey.employee_id = d.employee_id and ey.year = d.year)
    on conflict (employee_id, year) do nothing;

    with drift as (
        select ey.id,
               coalesce((select sum(d.days) from public.deductions d
                          where d.employee_id = ey.employee_id and d.year = ey.year), 0) as real_deducted
          from public.employee_years ey
         where (p_employee_ids is null or ey.employee_id = any(p_employee_ids))
    ),
    fixed as (
        update public.employee_years ey
           set deducted = drift.real_deducted
          from drift
         where ey.id = drift.id
           and coalesce(ey.deducted, 0) is distinct from drift.real_deducted
        returning 1
    )
    select count(*) into v_fixed from fixed;

    return v_fixed;
end;
$$;

-- Admin-facing wrapper: audit the whole database and repair any drift.
create or replace function public.reconcile_all_counters()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_username text; v_fixed int;
begin
    select role, coalesce(username, '') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;

    v_fixed := public.reconcile_counters(null);

    perform public.log_action(v_role, v_username, 'مطابقة عدّادات الخصم',
        format('تمت مطابقة العدّادات مع سجل الخصومات — عدد الصفوف المصحّحة: %s', v_fixed));
    return jsonb_build_object('fixed', v_fixed);
end;
$$;


-- ---------------------------------------------------------------------
-- 3. (6/9/10/17) REGISTER A DEDUCTION — rebuilt guards
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

    -- (6) Insufficient-balance protection, now measured against the days
    -- ACTUALLY ACCRUED so far — identical to what the UI shows — instead
    -- of the full annual allocation stored in employee_years.added.
    -- Bypassed for unpaid leave employees (their balance is 0 by design).
    if not emp.is_unpaid_leave then
        v_net := public.employee_net_balance(emp.id);
        if v_days > v_net then
            raise exception 'فشلت العملية: رصيد الموظف الحالي غير كافٍ لتغطية عدد أيام الخصم المطلوبة. الرصيد المستحق حتى اليوم: % يوم.', v_net;
        end if;
    end if;

    -- (17) Honour the allocation the admin configured for that year
    -- instead of assuming 30.
    select coalesce(default_days, 30) into v_year_default
        from public.years where year = v_year;

    insert into public.employee_years (employee_id, year, added, deducted)
    values (emp.id, v_year,
            case when emp.over_45 then 45 else coalesce(v_year_default, 30) end, 0)
    on conflict (employee_id, year) do nothing;

    update public.employee_years set deducted = deducted + v_days
        where employee_id = emp.id and year = v_year;

    insert into public.deductions (employee_id, year, start_date, end_date, days, note, created_by, created_at)
    values (emp.id, v_year, v_start, v_end, v_days, v_note, v_username, now());

    -- Post-update sanity check (defence in depth against race / logic
    -- bugs), on the same accrual basis as the pre-check above.
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
-- 4. (16) DELETE A DEDUCTION — exact counter restore, no silent clamp
-- ---------------------------------------------------------------------
create or replace function public.delete_deduction(p_deduction_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text; v_username text; d public.deductions%rowtype;
    v_frozen boolean;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    select * into d from public.deductions where id = p_deduction_id for update;
    if not found then raise exception 'سجل الخصم غير موجود'; end if;

    delete from public.deductions where id = d.id;

    -- Recompute from the register rather than subtracting blindly. The
    -- old greatest(0, deducted - days) silently swallowed any pre-existing
    -- drift and left the balance permanently wrong.
    perform public.reconcile_counters(array[d.employee_id]);

    -- A year already frozen into year_archives now disagrees with live
    -- data. Don't rewrite the sealed snapshot — record that it is stale.
    select exists (select 1 from public.year_archives where year = d.year) into v_frozen;

    perform public.log_action(v_role, v_username, 'حذف خصم إجازة',
        format('تم حذف خصم %s يوم لسنة %s%s', d.days, d.year,
               case when v_frozen
                    then format(' — تنبيه: الأرشيف المنفصل لسنة %s أصبح غير مطابق للبيانات الحية، يُنصح بإعادة أرشفتها', d.year)
                    else '' end));

    return jsonb_build_object('employee', public.get_employee_json(d.employee_id),
                              'archiveStale', v_frozen);
end;
$$;


-- ---------------------------------------------------------------------
-- 5. (7/17) ADD YEAR — refuse to travel backwards
-- ---------------------------------------------------------------------
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
    v_prev text;
    v_max text;
    v_this_year int;
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
    v_default := greatest(0, coalesce(p_default_days, 30));

    -- (7) A brand-new year must be NEWER than every year the system has
    -- ever known. Without this, typing an old year re-ceiled every
    -- employee's carried-forward balance at that year and wiped the
    -- entire computed history — one keystroke, no undo.
    if not v_was_archived then
        select max(year) into v_max from public.years;
        if v_max is not null and v_year <= v_max then
            raise exception 'لا يمكن إضافة سنة مالية أقدم من أو مساوية لآخر سنة مسجلة (%). السنوات السابقة تُستعاد من الأرشيف ولا تُضاف من جديد.', v_max;
        end if;
        v_this_year := extract(year from (now() at time zone 'Africa/Tripoli'))::int;
        if v_year::int > v_this_year + 1 then
            raise exception 'لا يمكن فتح سنة مالية أبعد من % (السنة التالية للسنة الحالية).', v_this_year + 1;
        end if;
    end if;

    -- Year roll-over: opening a brand-new year freezes the previous
    -- active year into its own isolated archive (separate from the new
    -- year). Never touches live rows.
    if not v_was_archived then
        select max(y.year) into v_prev
        from public.years y
        where y.is_archived = false and y.year < v_year;
        if v_prev is not null then
            insert into public.year_archives (year, frozen_by, snapshot)
            values (v_prev, v_username, public.build_year_archive_snapshot(v_prev))
            on conflict (year) do update
                set frozen_at = now(),
                    frozen_by = excluded.frozen_by,
                    snapshot   = excluded.snapshot;
            perform public.log_action(v_role, v_username, 'أرشفة سنة مالية',
                format('تم حفظ الأرشيف المنفصل للسنة %s تلقائياً عند فتح سنة %s', v_prev, v_year));
        end if;
    end if;

    if v_was_archived then
        update public.years set is_archived = false, default_days = v_default where year = v_year;
    else
        insert into public.years (year, default_days) values (v_year, v_default);
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

    perform public.log_action(v_role, v_username, 'إضافة سنة مالية', format('السنة: %s', v_year));
    return jsonb_build_object('years',
        coalesce((select jsonb_agg(year order by cast(year as integer))
                  from public.years where is_archived = false), '[]'::jsonb));
end;
$$;


-- ---------------------------------------------------------------------
-- 6. (8) SYNC — self-healing counters after a JSON import
-- ---------------------------------------------------------------------
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
    v_touched bigint[] := '{}';
    v_fixed int := 0;
begin
    select role, coalesce(username,'') into v_role, v_username
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

    for emp in select value from jsonb_array_elements(coalesce(p_payload->'employees','[]'::jsonb)) loop
        if coalesce(trim(emp->>'name'), '') = '' then continue; end if;

        v_target := null;
        if nullif(emp->>'id','') is not null then
            select id into v_target from public.employees where id = (emp->>'id')::bigint;
        end if;
        if v_target is null and coalesce(trim(emp->>'job_number'),'') <> '' then
            select id into v_target from public.employees
                where job_number = trim(emp->>'job_number') limit 1;
        end if;

        if v_target is null then
            insert into public.employees
                (id, name, job_number, national_id, job_title, initial_carried_forward, over_45, is_frozen, include_in_print, is_unpaid_leave, is_archived, hire_date, hire_date_current_year, created_at)
            values (
                coalesce(nullif(emp->>'id','')::bigint,
                         nextval(pg_get_serial_sequence('public.employees','id'))),
                trim(emp->>'name'),
                coalesce(trim(emp->>'job_number'),''),
                coalesce(trim(emp->>'national_id'),''),
                coalesce(trim(emp->>'job_title'),''),
                coalesce((emp->>'initial_carried_forward')::numeric, 0),
                coalesce((emp->>'over_45')::boolean, false),
                coalesce((emp->>'is_frozen')::boolean, false),
                coalesce((emp->>'include_in_print')::boolean, true),
                coalesce((emp->>'is_unpaid_leave')::boolean, false),
                coalesce((emp->>'is_archived')::boolean, false),
                coalesce(trim(emp->>'hire_date'),''),
                coalesce(nullif(emp->>'hire_date_current_year',''), null)::date,
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
                include_in_print = coalesce((emp->>'include_in_print')::boolean, include_in_print),
                is_unpaid_leave = coalesce((emp->>'is_unpaid_leave')::boolean, is_unpaid_leave),
                is_archived = coalesce((emp->>'is_archived')::boolean, is_archived),
                hire_date = coalesce(trim(emp->>'hire_date'), hire_date),
                hire_date_current_year = coalesce(nullif(emp->>'hire_date_current_year',''), hire_date_current_year)::date
            where id = v_target;
            v_updated := v_updated + 1;
        end if;

        v_touched := array_append(v_touched, v_target);

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
                if nullif(ded->>'id','') is not null then
                    insert into public.deductions
                        (id, employee_id, year, start_date, end_date, days, note, created_by, created_at)
                    values ((ded->>'id')::bigint, v_target, coalesce(ded->>'year',''),
                            coalesce(ded->>'start',''), coalesce(ded->>'end',''),
                            (ded->>'days')::numeric,
                            nullif(left(trim(coalesce(ded->>'note','')),500),''),
                            ded->>'createdBy', coalesce((ded->>'createdAt')::timestamptz, now()))
                    on conflict (id) do nothing;
                else
                    insert into public.deductions
                        (employee_id, year, start_date, end_date, days, note, created_by, created_at)
                    values (v_target, coalesce(ded->>'year',''), coalesce(ded->>'start',''),
                            coalesce(ded->>'end',''), (ded->>'days')::numeric,
                            nullif(left(trim(coalesce(ded->>'note','')),500),''),
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

    -- keep the identity sequences ahead of any explicit ids we inserted
    perform setval(pg_get_serial_sequence('public.employees','id'),
                   (select coalesce(max(id),1) from public.employees),
                   (select count(*) > 0 from public.employees));
    perform setval(pg_get_serial_sequence('public.deductions','id'),
                   (select coalesce(max(id),1) from public.deductions),
                   (select count(*) > 0 from public.deductions));

    -- (8) The payload overwrites employee_years.deducted wholesale while
    -- deduction rows merge by id (do nothing on conflict). Importing an
    -- older export therefore rolled the counters back while the newer
    -- deduction rows stayed — a permanent, silent divergence between the
    -- counter and the register it is supposed to summarise. Recompute the
    -- counters from the register so the two can never disagree.
    v_fixed := public.reconcile_counters(v_touched);

    perform public.log_action(v_role, v_username, 'مزامنة سحابية (استيراد JSON)',
        format('موظفون جدد: %s، تحديثات: %s، خصومات: %s، عدّادات صُحّحت: %s',
               v_created, v_updated, v_ded, v_fixed));
    return jsonb_build_object('created', v_created, 'updated', v_updated,
                              'deductions', v_ded, 'reconciled', v_fixed);
end;
$$;


-- ---------------------------------------------------------------------
-- 7. (2) YEAR ARCHIVES — admin-only, for real this time
-- ---------------------------------------------------------------------
-- build_year_archive_snapshot() is SECURITY DEFINER and reads employees
-- WITHOUT the is_archived filter, so the grant to `authenticated` handed
-- every logged-in account — including a plain 'viewer' — a full dump of
-- every employee's name, national id and balances, archived ones
-- included. Nothing in the client ever calls it directly; add_year() and
-- finalize_year() invoke it as the function owner and are unaffected.
revoke execute on function public.build_year_archive_snapshot(text) from public;
revoke execute on function public.build_year_archive_snapshot(text) from anon;
revoke execute on function public.build_year_archive_snapshot(text) from authenticated;

-- The RLS policy on year_archives was never reached: a SECURITY DEFINER
-- function runs as the table owner and bypasses RLS entirely. The role
-- check has to live inside the function body.
create or replace function public.list_year_archives()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text;
begin
    select role into v_role from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object(
                   'year', ya.year, 'frozenAt', ya.frozen_at,
                   'frozenBy', ya.frozen_by,
                   'employeesCount', jsonb_array_length(ya.snapshot->'employees')
               ) order by ya.year desc)
        from public.year_archives ya), '[]'::jsonb);
end;
$$;

create or replace function public.get_year_archive(p_year text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text; v_snap jsonb;
begin
    select role into v_role from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    select snapshot into v_snap from public.year_archives where year = trim(coalesce(p_year, ''));
    if not found then raise exception 'لا يوجد أرشيف محفوظ لهذه السنة'; end if;
    return v_snap;
end;
$$;


-- ---------------------------------------------------------------------
-- 8. (4) SUPER-ADMIN PROTECTION AT THE TABLE LEVEL
-- ---------------------------------------------------------------------
-- update_user_role()/delete_auth_user() guarded the root account, but the
-- profiles_admin_write policy is `for all`, so any admin could simply
-- PATCH /profiles?id=eq.<root> over REST and demote or delete it,
-- bypassing both functions. A trigger cannot be routed around.
create or replace function public.protect_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'DELETE' then
        if old.email = public.super_admin_email() then
            raise exception 'لا يمكن حذف المدير الأساسي للنظام';
        end if;
        return old;
    end if;

    if old.email = public.super_admin_email() then
        if new.role is distinct from old.role then
            raise exception 'لا يمكن تعديل صلاحية المدير الأساسي للنظام';
        end if;
        if new.email is distinct from old.email then
            raise exception 'لا يمكن تغيير البريد الإلكتروني للمدير الأساسي للنظام';
        end if;
        if new.id is distinct from old.id then
            raise exception 'لا يمكن تغيير معرّف المدير الأساسي للنظام';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists profiles_protect_super_admin on public.profiles;
create trigger profiles_protect_super_admin
    before update or delete on public.profiles
    for each row execute function public.protect_super_admin();


-- ---------------------------------------------------------------------
-- 9. (5) ACTIVITY LOG — stamped by the server, not by the caller
-- ---------------------------------------------------------------------
-- The old policy was `with check (true)`: any logged-in account could
-- insert rows carrying any user_email it liked, so the security trail
-- that answers "who did this" was forgeable by the very people it exists
-- to hold accountable.
create or replace function public.log_activity(p_action_type text, p_details text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_email text;
begin
    if auth.uid() is null then raise exception 'غير مصرح'; end if;
    select email into v_email from public.profiles where id = auth.uid();
    insert into public.activity_logs (user_id, user_email, action_type, details)
    values (
        auth.uid(),
        coalesce(nullif(trim(v_email), ''), 'غير معروف'),
        left(trim(coalesce(p_action_type, '')), 200),
        left(trim(coalesce(p_details, '')), 1000)
    );
end;
$$;

drop policy if exists "authenticated can insert activity_logs" on public.activity_logs;
revoke insert, update, delete on public.activity_logs from authenticated;
grant execute on function public.log_activity(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 10. (3/15) INVITE CODES
-- ---------------------------------------------------------------------
-- The read policy was `using (true)` for every authenticated role, and
-- consume_invite_code() only checked that SOMEBODY was logged in. Any
-- 'viewer' could therefore list the unused codes, pick a data_entry one,
-- redeem it, and gain the right to alter employee balances.
drop policy if exists "authenticated can read invite_codes" on public.invite_codes;
drop policy if exists invite_codes_select on public.invite_codes;
create policy "admin can read invite_codes"
    on public.invite_codes for select
    to authenticated
    using (public.current_app_role() = 'admin');

-- (15) Server-side generation with gen_random_bytes. The browser was
-- minting codes with Math.random() and spelling the granted role out
-- inside the code string.
create or replace function public.generate_invite_code(p_role text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_code text;
    v_role text; v_username text;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    if p_role not in ('data_entry', 'viewer') then
        raise exception 'الصلاحية غير صالحة';
    end if;

    v_code := 'WQF-' || upper(encode(extensions.gen_random_bytes(8), 'hex'));
    insert into public.invite_codes (code, role, created_by)
    values (v_code, p_role, auth.uid());

    perform public.log_action(v_role, v_username, 'إنشاء رمز دعوة',
        format('تم إنشاء رمز دعوة بصلاحية %s', p_role));
    return v_code;
end;
$$;

-- Callable before sign-up (the registration portal has no session yet),
-- so it must reveal nothing beyond "this exact code is valid".
create or replace function public.validate_invite_code(p_code text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text;
begin
    select role into v_role
      from public.invite_codes
     where code = trim(coalesce(p_code, '')) and is_used = false;
    if not found then
        raise exception 'رمز الدعوة غير صالح أو تم استخدامه مسبقاً';
    end if;
    return v_role;
end;
$$;

create or replace function public.consume_invite_code(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text;
    v_current_role text;
    v_created timestamptz;
begin
    if auth.uid() is null then
        raise exception 'غير مصرح';
    end if;

    select role, created_at into v_current_role, v_created
      from public.profiles where id = auth.uid();
    if v_current_role is null then raise exception 'الحساب غير مُهيأ'; end if;

    -- A code may only be redeemed by the account that was just created
    -- with it. These three guards are what stop an existing 'viewer' from
    -- redeeming a data_entry code to promote itself.
    if v_current_role is distinct from 'viewer' then
        raise exception 'رمز الدعوة يُستخدم مرة واحدة فقط عند إنشاء الحساب';
    end if;
    if v_created < now() - interval '15 minutes' then
        raise exception 'انتهت مهلة استخدام رمز الدعوة. يرجى التواصل مع مدير النظام.';
    end if;
    if exists (select 1 from public.invite_codes where used_by = auth.uid()) then
        raise exception 'تم استخدام رمز دعوة لهذا الحساب مسبقاً';
    end if;

    -- Lock the row so two concurrent redemptions can't both succeed.
    select role into v_role from public.invite_codes
        where code = trim(coalesce(p_code, '')) and is_used = false
        for update;
    if not found then
        raise exception 'رمز الدعوة غير صالح أو سبق استخدامه';
    end if;

    update public.invite_codes
       set is_used = true, used_by = auth.uid(), used_at = now()
     where code = trim(coalesce(p_code, ''));

    -- The only role grant this function performs. invite_codes.role is
    -- constrained to ('data_entry','viewer'), so it can never mint admin.
    update public.profiles set role = v_role where id = auth.uid();

    return v_role;
end;
$$;

grant execute on function public.generate_invite_code(text) to authenticated;
grant execute on function public.validate_invite_code(text)  to anon, authenticated;
grant execute on function public.consume_invite_code(text)   to authenticated;


-- ---------------------------------------------------------------------
-- 11. (11/12) USERNAMES — unique, and unenumerable from outside
-- ---------------------------------------------------------------------
-- Existing duplicates have to go before the unique index can be built.
-- The suffix is derived from the row's own uuid, so it cannot collide.
update public.profiles p
   set username = p.username || '-' || left(replace(p.id::text, '-', ''), 6)
  from (
      select id,
             row_number() over (
                 partition by lower(trim(username)) order by created_at, id
             ) as rn
        from public.profiles
       where username is not null and trim(username) <> ''
  ) d
 where p.id = d.id and d.rn > 1;

create unique index if not exists profiles_username_unique_idx
    on public.profiles (lower(trim(username)))
    where username is not null and trim(username) <> '';

-- (11) The username still comes from client-supplied sign-up metadata, so
-- a self-registering user could previously claim the admin's exact name;
-- resolve_login()'s `limit 1` would then hand the admin's login the wrong
-- email and lock them out. Collisions are now suffixed instead of taken.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_base text;
    v_name text;
begin
    v_base := nullif(trim(coalesce(new.raw_user_meta_data->>'username', '')), '');
    if v_base is null then
        v_base := split_part(coalesce(new.email, ''), '@', 1);
    end if;
    if v_base is null or v_base = '' then
        v_base := 'user';
    end if;

    v_name := v_base;
    if exists (select 1 from public.profiles
                where lower(trim(username)) = lower(trim(v_name))) then
        v_name := v_base || '-' || left(replace(new.id::text, '-', ''), 6);
    end if;

    insert into public.profiles (id, username, role, email)
    values (
        new.id,
        v_name,
        'viewer', -- never trust a client-supplied role; the only way up is
                  -- consume_invite_code() (server-side), and admins are
                  -- only minted by an existing admin via update_user_role()
        new.email
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

-- (12) Returning NULL for an unknown username told an anonymous caller
-- exactly which names exist. Hand back a syntactically valid but
-- unusable address instead, so sign-in fails with the same generic
-- "wrong credentials" for a bad name as for a bad password.
create or replace function public.resolve_login(p_identifier text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_ident text := trim(coalesce(p_identifier, ''));
    v_email text;
begin
    if v_ident = '' then return null; end if;
    if position('@' in v_ident) > 0 then return v_ident; end if;

    select email into v_email from public.profiles
     where lower(trim(username)) = lower(v_ident)
     limit 1;

    return coalesce(v_email, 'unknown-' || md5(lower(v_ident)) || '@invalid.local');
end;
$$;

grant execute on function public.resolve_login(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 12. (13) IN-APP USER CREATION — stronger floor, clearer failures
-- ---------------------------------------------------------------------
-- This function writes straight into GoTrue's own tables, which Supabase
-- owns and may change on any platform upgrade. That coupling cannot be
-- removed from SQL alone, so the failure mode is at least made explicit
-- instead of surfacing as an opaque Postgres error.
create or replace function public.create_user(
    p_email    text,      -- generated internally; kept out of the UI
    p_password text,
    p_username text,
    p_role     text default 'viewer'
)
returns json
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp, extensions
as $$
declare
    v_user_id  uuid;
    v_enc_pw   text;
    v_email    text;
    v_username text;
    v_actor    text;
begin
    select coalesce(username,'') into v_actor from public.profiles where id = auth.uid();
    if public.current_app_role() != 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    if p_role not in ('data_entry', 'viewer') then
        raise exception 'الصلاحية غير صالحة';
    end if;

    v_username := trim(coalesce(p_username, ''));
    if v_username = '' then
        raise exception 'يرجى إدخال اسم المستخدم';
    end if;
    if char_length(v_username) > 60 then
        raise exception 'اسم المستخدم طويل جداً (60 حرفاً كحد أقصى)';
    end if;
    if char_length(coalesce(p_password, '')) < 8 then
        raise exception 'كلمة المرور يجب أن تكون 8 أحرف على الأقل';
    end if;
    -- Uniqueness is enforced by profiles_username_unique_idx; this check
    -- only produces a friendlier message for the common case.
    if exists (select 1 from public.profiles
                where lower(trim(username)) = lower(v_username)) then
        raise exception 'هذا الاسم مسجل مسبقاً للمستخدمين';
    end if;

    v_email   := 'wqf-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) || '@internal.local';
    v_user_id := gen_random_uuid();
    v_enc_pw  := extensions.crypt(p_password, extensions.gen_salt('bf'));

    begin
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                                email_confirmed_at, created_at, updated_at,
                                confirmation_token, recovery_token,
                                email_change_token_new, email_change, raw_app_meta_data,
                                raw_user_meta_data, is_super_admin)
        values ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
                v_email, v_enc_pw, now(), now(), now(),
                '', '', '', '', '{"provider":"email","providers":["email"]}',
                jsonb_build_object('username', v_username, 'role', p_role), false);

        insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at,
                                     created_at, updated_at, id)
        values (v_email, v_user_id,
                jsonb_build_object('sub', v_user_id::text, 'email', v_email),
                'email', now(), now(), now(), v_user_id);
    exception
        when unique_violation then
            raise exception 'هذا الاسم مسجل مسبقاً للمستخدمين';
        when undefined_column or undefined_table then
            raise exception 'تعذر إنشاء الحساب: تغيّرت بنية نظام المصادقة في Supabase. يرجى إبلاغ مطوّر النظام لتحديث دالة إنشاء المستخدمين.';
    end;

    update public.profiles set role = p_role where id = v_user_id;

    perform public.log_action('admin', v_actor, 'إنشاء مستخدم',
        format('تم إنشاء المستخدم "%s" بصلاحية %s', v_username, p_role));

    return json_build_object('id', v_user_id, 'email', v_email, 'username', v_username);
end;
$$;

grant execute on function public.create_user(text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 13. GRANTS for the new functions
-- ---------------------------------------------------------------------
-- employee_net_balance/accrued_days are read-only helpers; the client may
-- call them to show the same number the guard uses.
grant execute on function public.accrued_days(text, boolean, date, timestamptz) to authenticated;
grant execute on function public.employee_net_balance(bigint)                   to authenticated;
grant execute on function public.reconcile_all_counters()                       to authenticated;

-- reconcile_counters() is the internal engine; only the admin wrapper and
-- the RPCs above may drive it.
revoke all on function public.reconcile_counters(bigint[]) from public;
revoke all on function public.reconcile_counters(bigint[]) from anon;
revoke all on function public.reconcile_counters(bigint[]) from authenticated;

revoke all on function public.log_activity(text, text)   from public;
revoke all on function public.log_activity(text, text)   from anon;
grant execute on function public.log_activity(text, text) to authenticated;

revoke all on function public.protect_super_admin() from public;


-- ---------------------------------------------------------------------
-- 14. ONE-TIME REPAIR — heal any drift that already exists
-- ---------------------------------------------------------------------
do $$
declare v_fixed int;
begin
    v_fixed := public.reconcile_counters(null);
    raise notice 'reconcile_counters: % employee-year counter(s) corrected', v_fixed;
end;
$$;
