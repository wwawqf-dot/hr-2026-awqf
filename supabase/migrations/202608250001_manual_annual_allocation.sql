-- =====================================================================
--  Manual annual allocation — the monthly accrual engine is retired
--  -------------------------------------------------------------------
--  Until now the yearly entitlement was DISPLAYED as an accrual: the
--  database stored the full 30 (or 45) days on employee_years.added when
--  a year was opened, but every read path — the employees table, the
--  printed report, the statement, and the server-side deduction guard —
--  threw that stored figure away for the CURRENT year and recomputed it
--  from the clock as (closed months × 2.5, or × 3.75 on the 45 track).
--  An employee therefore "grew" 2.5 days on the first of every month,
--  and the header tracked that with a rolling cut-off date reading
--  "مضاف حتى 31/07/2026".
--
--  The system is now manual: the whole year is granted ONCE, at the start
--  of the year, and the stored number is the truth from that moment on.
--  Nothing recomputes it from the calendar afterwards, so the figure an
--  employee sees on 1 January is the figure they see on 31 December, and
--  the label reads that year's own end date — "مضاف حتى 31/12/2026" —
--  rolling over by itself when the year does.
--
--  Two things deliberately survive the change:
--
--    * The 45-day track and the per-year `years.default_days` setting.
--      "30 days" is the DEFAULT allocation, not a hardcoded constant.
--
--    * Proration for an employee's OWN hire year. Someone who joins in
--      August has not had a full year in which to earn leave, so their
--      first (partial) year is granted pro rata — computed once, at
--      insert time, and then stored like any other allocation. From
--      their second year onward they receive the full annual grant like
--      everyone else. The 15th-of-the-month rule still decides which
--      month their entitlement starts from.
--
--  This migration is the database half; the front-end half (libyaTime.js,
--  leaveCalc.js and every consumer) lands in the same change.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. THE ALLOCATION RULE, IN ONE PLACE
-- ---------------------------------------------------------------------
-- Every writer below routes through this function, so "how many days does
-- this employee get for this year" has a single answer that cannot drift
-- between call sites.
create or replace function public.year_allocation(
    p_year                   text,
    p_over_45                boolean default false,
    p_hire_date_current_year date    default null,
    p_default_days           numeric default 30
) returns numeric
language plpgsql
stable
as $$
declare
    v_annual numeric;
    v_month  int;
    v_day    int;
    v_first  int;
begin
    if p_year is null or p_year !~ '^\d{4}$' then return 0; end if;

    -- The 45-day track is fixed by regulation; everyone else gets the
    -- allocation configured for that specific year (30 unless changed).
    v_annual := case when coalesce(p_over_45, false)
                     then 45
                     else greatest(0, coalesce(p_default_days, 30)) end;

    -- Not this employee's hire year (or no hire date recorded at all):
    -- the full year is granted.
    if p_hire_date_current_year is null
       or extract(year from p_hire_date_current_year)::int <> p_year::int
    then
        return round(v_annual, 2);
    end if;

    -- Hire year: granted pro rata over the months the employee will
    -- actually be in post, counting from their first entitled month
    -- through December. Joining after the 15th starts the entitlement
    -- the following month.
    v_month := extract(month from p_hire_date_current_year)::int;
    v_day   := extract(day   from p_hire_date_current_year)::int;
    v_first := case when v_day > 15 then v_month + 1 else v_month end;
    if v_first > 12 then return 0; end if;

    -- round(...,2), not (...,1): the 45-day track's monthly twelfth is
    -- 3.75, and one decimal place would mangle it into 3.8.
    return round((13 - v_first) * (v_annual / 12.0), 2);
end;
$$;

comment on function public.year_allocation(text, boolean, date, numeric) is
    'Days granted to an employee for one financial year under manual allocation: the full annual figure, prorated only across the employee''s own hire year.';


-- ---------------------------------------------------------------------
-- 2. THE BALANCE — stored grants, not elapsed months
-- ---------------------------------------------------------------------
-- Mirror of computeNetBalance() in leaveCalc.js. Every year, the current
-- one included, now contributes the allocation actually recorded against
-- it. Unpaid leave still freezes the current year's grant at 0 while
-- leaving every historical figure intact.
create or replace function public.employee_net_balance(p_employee_id bigint)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    emp        public.employees%rowtype;
    v_cur_year text;
    v_balance  numeric;
begin
    select * into emp from public.employees where id = p_employee_id;
    if not found then return 0; end if;

    v_cur_year := to_char((now() at time zone 'Africa/Tripoli')::date, 'YYYY');

    select coalesce(emp.initial_carried_forward, 0)
         + coalesce(sum(
               case when ey.year = v_cur_year and emp.is_unpaid_leave
                    then 0 else coalesce(ey.added, 0) end
               - coalesce(ey.deducted, 0)), 0)
      into v_balance
      from public.employee_years ey
     where ey.employee_id = p_employee_id;

    return round(v_balance, 2);
end;
$$;


-- ---------------------------------------------------------------------
-- 3. WRITERS — every path that creates or changes an allocation row
-- ---------------------------------------------------------------------

-- 3a. Opening a financial year grants that year to every active employee.
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

    -- The whole year is granted here, once, and then never recomputed:
    -- this insert IS the "manual addition at the start of the year".
    -- year_allocation() prorates only an employee whose own hire date
    -- falls inside this very year; everyone else gets the full figure.
    insert into public.employee_years (employee_id, year, added, deducted)
    select id, v_year,
           public.year_allocation(v_year, over_45, hire_date_current_year, v_default), 0
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

-- 3b. A new employee is granted every open year at the moment of hire.
create or replace function public.create_employee(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text; v_username text;
    v_name text; v_hire text; v_hire_current_year date;
    v_recon_note text;
    v_over45 boolean; v_initial numeric;
    v_has_remaining boolean; v_remaining numeric;
    v_years text[]; v_current text; v_year text; v_year_default numeric;
    v_added numeric; v_current_added numeric; v_available numeric; v_consumed numeric;
    v_new_id bigint;
begin
    select role, coalesce(username,'') into v_role, v_username
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
    v_recon_note := left(trim(coalesce(p_payload->>'reconciliationNote','')), 500);

    v_has_remaining := nullif(trim(coalesce(p_payload->>'actualRemainingBalance','')), '') is not null;
    if v_has_remaining then v_remaining := (p_payload->>'actualRemainingBalance')::numeric; end if;

    select array_agg(year order by cast(year as integer)) into v_years from public.years;
    v_current := case when array_length(v_years,1) is null then null
                       else v_years[array_length(v_years,1)] end;

    insert into public.employees
        (name, job_number, national_id, job_title, initial_carried_forward, over_45, is_frozen, include_in_print, is_unpaid_leave, hire_date, hire_date_current_year, created_at)
    values (
        v_name,
        trim(coalesce(p_payload->>'job_number','')),
        trim(coalesce(p_payload->>'national_id','')),
        trim(coalesce(p_payload->>'job_title','')),
        v_initial, v_over45, false,
        coalesce((p_payload->>'include_in_print')::boolean, true),
        coalesce((p_payload->>'is_unpaid_leave')::boolean, false),
        v_hire, v_hire_current_year, now()
    ) returning id into v_new_id;

    v_current_added := 0;
    if v_years is not null then
        foreach v_year in array v_years loop
            -- An explicit years_data figure (a restore, or a manual
            -- correction) always wins; otherwise the year is granted in
            -- full, prorated only if this is the employee's own hire year.
            v_added := nullif(p_payload->'years_data'->v_year->>'added', '')::numeric;
            if v_added is null then
                select coalesce(default_days, 30) into v_year_default
                    from public.years where year = v_year;
                v_added := public.year_allocation(
                    v_year, v_over45, v_hire_current_year, v_year_default);
            end if;
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

-- 3c. Editing the two inputs the grant derives from rewrites it.
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
    v_realloc_year text; v_year_default numeric;
    v_old_added numeric; v_new_added numeric;
    v_net numeric; v_diff numeric; v_recon_days numeric := 0;
    yd_key text; yd_val jsonb;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;

    select * into emp from public.employees where id = p_id for update;
    if not found then raise exception 'الموظف غير موجود'; end if;

    v_name := trim(coalesce(p_payload->>'name',''));
    if v_name = '' then raise exception 'يرجى إدخال اسم الموظف كاملاً'; end if;
    v_hire := trim(coalesce(p_payload->>'hire_date',''));
    if v_hire <> '' and v_hire !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'تاريخ المباشرة يجب أن يكون بصيغة YYYY-MM-DD';
    end if;

    v_hire_current_year := nullif(p_payload->>'hire_date_current_year', '')::date;
    v_initial := coalesce((p_payload->>'initial_carried_forward')::numeric, 0);
    v_recon_note := left(trim(coalesce(p_payload->>'reconciliationNote','')), 500);
    v_has_remaining := nullif(trim(coalesce(p_payload->>'actualRemainingBalance','')), '') is not null;
    if v_has_remaining then v_remaining := (p_payload->>'actualRemainingBalance')::numeric; end if;

    update public.employees set
        name = v_name,
        job_number  = trim(coalesce(p_payload->>'job_number','')),
        national_id = trim(coalesce(p_payload->>'national_id','')),
        job_title   = trim(coalesce(p_payload->>'job_title','')),
        initial_carried_forward = v_initial,
        over_45   = coalesce((p_payload->>'over_45')::boolean, false),
        is_unpaid_leave = coalesce((p_payload->>'is_unpaid_leave')::boolean, false),
        include_in_print = coalesce((p_payload->>'include_in_print')::boolean, true),
        hire_date = v_hire,
        hire_date_current_year = v_hire_current_year
    where id = p_id;

    -- Manual allocation means the grant is a STORED number, so the two
    -- inputs it derives from have to write it back when they change --
    -- otherwise ticking "فوق 45" or correcting a hire date would leave the
    -- employee on their old entitlement forever. `emp` still holds the
    -- pre-update row, which is what makes the comparison possible.
    --
    -- Only the newest ACTIVE year is ever rewritten. Closed years stay
    -- frozen exactly as they were, and an employee whose over_45 / hire
    -- date did not change is never silently reset -- so an imported or
    -- hand-corrected figure survives an unrelated edit such as fixing a
    -- misspelt name.
    if v_hire_current_year is distinct from emp.hire_date_current_year
       or coalesce((p_payload->>'over_45')::boolean, false) is distinct from emp.over_45
    then
        select max(year) into v_realloc_year
            from public.years where coalesce(is_archived, false) = false;
        -- coalesce(): `null ? key` is NULL, not false, and a NULL here
        -- would silently skip the whole branch for every payload that
        -- carries no years_data at all -- which is the normal edit.
        if v_realloc_year is not null
           and not (coalesce(p_payload->'years_data', '{}'::jsonb) ? v_realloc_year)
        then
            select coalesce(default_days, 30) into v_year_default
                from public.years where year = v_realloc_year;
            v_new_added := public.year_allocation(
                v_realloc_year,
                coalesce((p_payload->>'over_45')::boolean, false),
                v_hire_current_year,
                v_year_default);
            select added into v_old_added from public.employee_years
                where employee_id = p_id and year = v_realloc_year;
            update public.employee_years set added = v_new_added
                where employee_id = p_id and year = v_realloc_year;

            -- Cutting a grant below leave the employee has already taken
            -- and had approved would store a debt, not a balance. Refuse
            -- the edit instead. Unpaid leave is exempt: its current-year
            -- grant is 0 by design and its balance may legitimately sit
            -- below zero.
            if v_new_added < coalesce(v_old_added, 0)
               and not coalesce((p_payload->>'is_unpaid_leave')::boolean, false)
               and public.employee_net_balance(p_id) < 0
            then
                raise exception 'لا يمكن حفظ التعديل: الرصيد المستحق للموظف (% يوم) يصبح أقل من الإجازات المخصومة له فعلياً. يرجى حذف الخصومات الزائدة أولاً ثم إعادة التعديل.', v_new_added;
            end if;
        end if;
    end if;

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
        v_current := case when array_length(v_years,1) is null then null
                          else v_years[array_length(v_years,1)] end;
        if v_current is not null then
            select v_initial + coalesce(sum(coalesce(added,0) - coalesce(deducted,0)), 0)
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

-- 3d. Bulk import.
create or replace function public.bulk_add_employees(p_rows jsonb, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text; v_username text; v_years text[]; v_current text;
    r jsonb; v_name text; v_id bigint; v_note text;
    v_created int := 0; v_skipped int := 0; v_reconciled int := 0;
    v_remaining numeric; v_consumed numeric; v_ids bigint[] := '{}';
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
        raise exception 'لا توجد بيانات موظفين صالحة للاستيراد';
    end if;

    v_note := left(trim(coalesce(p_note,'')), 500);
    select array_agg(year order by cast(year as integer)) into v_years from public.years;
    v_current := case when array_length(v_years,1) is null then null
                      else v_years[array_length(v_years,1)] end;

    for r in select value from jsonb_array_elements(p_rows) loop
        v_name := trim(coalesce(r->>'name',''));
        if v_name = '' then v_skipped := v_skipped + 1; continue; end if;

        insert into public.employees
            (name, job_number, national_id, job_title, initial_carried_forward, over_45, is_frozen, created_at)
        values (v_name, coalesce(trim(r->>'job_number'),''), coalesce(trim(r->>'national_id'),''),
                coalesce(trim(r->>'job_title'),''), 0, false, false, now())
        returning id into v_id;

        if v_years is not null then
            insert into public.employee_years (employee_id, year, added, deducted)
            select v_id, y.year,
                   public.year_allocation(y.year, false, null, coalesce(y.default_days, 30)), 0
              from public.years y where y.year = any(v_years)
            on conflict (employee_id, year) do nothing;
        end if;

        if nullif(trim(coalesce(r->>'remainingBalance','')),'') is not null and v_current is not null then
            v_remaining := (r->>'remainingBalance')::numeric;
            v_consumed  := 30 - v_remaining;  -- availableTotal defaults to 30 for bulk rows
            if v_consumed > 0 then
                update public.employee_years set deducted = deducted + v_consumed
                    where employee_id = v_id and year = v_current;
                insert into public.deductions (employee_id, year, start_date, end_date, days, note, created_by, created_at)
                values (v_id, v_current, '', '', v_consumed, v_note, v_username, now());
                v_reconciled := v_reconciled + 1;
            end if;
        end if;

        v_ids := array_append(v_ids, v_id);
        v_created := v_created + 1;
    end loop;

    perform setval(pg_get_serial_sequence('public.employees','id'),
                   (select coalesce(max(id),1) from public.employees),
                   (select count(*) > 0 from public.employees));
    perform public.log_action(v_role, v_username, 'استيراد جماعي للموظفين',
        format('تمت إضافة %s موظف (تخطي %s، تسوية %s)', v_created, v_skipped, v_reconciled));

    return jsonb_build_object(
        'created', v_created, 'skipped', v_skipped, 'reconciled', v_reconciled,
        'employees', coalesce(
            (select jsonb_agg(public.get_employee_json(id) order by id)
             from public.employees where id = any(v_ids)), '[]'::jsonb)
    );
end;
$$;

-- 3e. Counter repair: a restored row must carry the right allocation.
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
           public.year_allocation(d.year, e.over_45, e.hire_date_current_year,
                                  coalesce(y.default_days, 30)), 0
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

-- 3f. The deduction guard, and its fallback allocation row.
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
    if not emp.is_unpaid_leave then
        v_net := public.employee_net_balance(emp.id);
        if v_days > v_net then
            raise exception 'فشلت العملية: رصيد الموظف الحالي غير كافٍ لتغطية عدد أيام الخصم المطلوبة. الرصيد المتاح: % يوم.', v_net;
        end if;
    end if;

    -- (17) Honour the allocation the admin configured for that year
    -- instead of assuming 30.
    select coalesce(default_days, 30) into v_year_default
        from public.years where year = v_year;

    insert into public.employee_years (employee_id, year, added, deducted)
    values (emp.id, v_year,
            public.year_allocation(v_year, emp.over_45, emp.hire_date_current_year,
                                   coalesce(v_year_default, 30)), 0)
    on conflict (employee_id, year) do nothing;

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
-- 4. BACKFILL — align the rows written under the old rule
-- ---------------------------------------------------------------------
-- Mid-year hires are the only employees whose stored figure was wrong in
-- practice: add_year()/create_employee() wrote them the full 30 (or 45)
-- and the front-end quietly displayed a smaller accrued number over the
-- top. With the display no longer correcting anything, the stored row has
-- to be corrected instead — otherwise an employee hired in August would
-- jump from 10 displayed days to 30 overnight.
--
-- Scope is deliberately narrow: only rows for an employee's OWN hire
-- year, only where the stored value still equals the un-prorated annual
-- figure (i.e. no admin has touched it), and never where the correction
-- would strand leave that has already been taken and approved.
with corrected as (
    select ey.id,
           ey.added as old_added,
           public.year_allocation(ey.year, e.over_45, e.hire_date_current_year,
                                  coalesce(y.default_days, 30)) as new_added
      from public.employee_years ey
      join public.employees e on e.id = ey.employee_id
      join public.years     y on y.year = ey.year
     where e.hire_date_current_year is not null
       and ey.year ~ '^\d{4}$'
       and extract(year from e.hire_date_current_year)::int = ey.year::int
       and ey.added = case when e.over_45 then 45 else coalesce(y.default_days, 30) end
)
update public.employee_years ey
   set added = c.new_added
  from corrected c
 where ey.id = c.id
   and c.new_added <> c.old_added
   -- never strand an already-approved leave behind a reduced grant
   and c.new_added >= ey.deducted;


-- ---------------------------------------------------------------------
-- 5. RETIRE THE ACCRUAL FUNCTION
-- ---------------------------------------------------------------------
-- Nothing calls accrued_days() any more — employee_net_balance() above
-- was its last caller, and no client ever invoked it directly. Leaving it
-- in place would leave a granted, callable function whose name asserts a
-- rule the system no longer follows.
drop function if exists public.accrued_days(text, boolean, date, timestamptz);


-- ---------------------------------------------------------------------
-- 6. GRANTS
-- ---------------------------------------------------------------------
-- year_allocation() is a pure, read-only rule with no table access; the
-- client may legitimately want it to preview what a new hire will get.
revoke execute on function public.year_allocation(text, boolean, date, numeric) from public;
revoke execute on function public.year_allocation(text, boolean, date, numeric) from anon;
grant  execute on function public.year_allocation(text, boolean, date, numeric) to authenticated;
grant  execute on function public.employee_net_balance(bigint)                  to authenticated;
