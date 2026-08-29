-- =====================================================================
--  Open the financial year automatically when the calendar enters it
--  -------------------------------------------------------------------
--  Opening the new year was a manual admin action, and until it happened
--  register_deduction() rejected every leave dated in the new year with
--  a message naming the OLD one — which reads as a fault in the program
--  rather than as a step nobody had taken yet. The first working days of
--  January were effectively read-only for leave entry.
--
--  add_year() is split rather than duplicated: its body becomes
--  open_financial_year(), an internal engine revoked from every client
--  role, and two wrappers decide who may drive it —
--
--      add_year()             admin only, the Settings button, unchanged
--      ensure_current_year()  any signed-in user, called on app load
--
--  Everything the old function did still happens in the same order, and
--  that order matters: the outgoing year is SETTLED to its full annual
--  entitlement before the archive snapshot freezes it, and only then is
--  the carry-forward computed and ceiled. Opening the year automatically
--  therefore cannot cost anyone the 31 December installment.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. THE ENGINE
-- ---------------------------------------------------------------------
create or replace function public.open_financial_year(
    p_year text, p_default_days numeric default 30,
    p_role text default 'system', p_username text default '')
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
    -- No role check here on purpose: this is the engine, revoked from every
    -- client role, and the two wrappers below decide who may drive it. The
    -- actor is passed in so the archive snapshot and the activity log still
    -- record who (or what) opened the year.
    v_role := coalesce(p_role, 'system');
    v_username := coalesce(p_username, '');
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
            -- Closing a year declares it finished, so the arrears rule
            -- has no months left to wait for: settle whatever it still
            -- owes before the snapshot freezes the figures forever.
            -- Without this, closing 2026 on 15 December would archive
            -- every employee at 15 days and lose the second installment
            -- with no way to recover it. Evaluated AS OF 31 December of
            -- that year, and only ever upward.
            update public.employee_years ey
               set added = public.allocation_due(ey.year, e.over_45,
                               e.hire_date_current_year,
                               coalesce(y.default_days, 30),
                               make_date(ey.year::int, 12, 31))
              from public.employees e, public.years y
             where ey.employee_id = e.id
               and y.year = ey.year
               and ey.year = v_prev
               and e.is_archived = false
               and public.allocation_due(ey.year, e.over_45,
                       e.hire_date_current_year, coalesce(y.default_days, 30),
                       make_date(ey.year::int, 12, 31)) > ey.added;

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

    -- The opening balance of the year being opened is what the employee
    -- carried OUT of the years that closed before it, so the sum must
    -- exclude v_year itself. The row for v_year was inserted a few lines
    -- above carrying this year's full grant; including it here made
    -- ceiled_cumulative_balance contain that grant, and the ledger then
    -- added the very same grant a second time on top of the opening it
    -- had just been handed (computeYearlyLedger takes this value AS the
    -- opening, then adds the year's `added` to it). Every employee's
    -- "الصافي التراكمي" therefore read exactly one annual grant too high
    -- from the moment a financial year was opened.
    --
    -- `year < v_year` rather than `year <> v_year`: restoring an archived
    -- year is allowed to reopen a year OLDER than the newest one, and in
    -- that case the opening must still be the balance carried out of the
    -- years before it, not a total that sweeps in the years after it.
    for emp in select e.id, e.initial_carried_forward from public.employees e where e.is_archived = false loop
        select coalesce(emp.initial_carried_forward, 0)
             + coalesce(sum(coalesce(added,0) - coalesce(deducted,0)), 0)
          into v_running
          from public.employee_years
         where employee_id = emp.id
           and year < v_year;
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
-- 2. THE MANUAL DOOR — unchanged behaviour for the Settings button
-- ---------------------------------------------------------------------
create or replace function public.add_year(p_year text, p_default_days numeric default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_username text;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then raise exception 'هذه العملية مقصورة على المدير'; end if;
    return public.open_financial_year(p_year, p_default_days, v_role, v_username);
end;
$$;


-- ---------------------------------------------------------------------
-- 3. THE AUTOMATIC DOOR — opens the year the calendar has entered
-- ---------------------------------------------------------------------
-- Until the new financial year exists, register_deduction() refuses every
-- leave dated inside it, quoting the OLD year in the error. That made the
-- first working days of January unusable for recording leave until an
-- admin happened to notice.
--
-- Open to any signed-in user, not admins only: the clerk who opens the
-- app first on 2 January is usually not the admin, and making them wait
-- is the whole problem. What the caller can trigger is fixed and
-- deterministic — open THIS calendar year, once, and only if the system
-- is already running a year older than it. There is no argument to abuse.
--
-- It will not invent the very first year of a fresh install: with no years
-- at all this returns without acting, because that is a setup decision
-- about opening balances, not a calendar rollover.
create or replace function public.ensure_current_year()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cur      text := to_char((now() at time zone 'Africa/Tripoli')::date, 'YYYY');
    v_max      text;
    v_default  numeric;
    v_role     text;
    v_username text;
begin
    if auth.uid() is null then
        raise exception 'يلزم تسجيل الدخول';
    end if;

    -- Serialise on the year itself. Two people signing in within the same
    -- second on 1 January would otherwise both pass the checks below and
    -- the loser would surface 'هذه السنة مسجلة مسبقاً' as a login error.
    perform pg_advisory_xact_lock(hashtext('ensure_current_year:' || v_cur));

    if exists (select 1 from public.years where year = v_cur and is_archived = false) then
        return jsonb_build_object('opened', false, 'year', v_cur);
    end if;

    select max(year) into v_max from public.years;
    if v_max is null then
        return jsonb_build_object('opened', false, 'year', null);   -- fresh install
    end if;
    if v_max >= v_cur then
        return jsonb_build_object('opened', false, 'year', v_cur);  -- already ahead
    end if;

    -- Carry the previous year's configured allocation rather than assuming
    -- 30: an office that set 32 does not want it silently reset in January.
    select coalesce(default_days, 30) into v_default
        from public.years where year = v_max;

    select role, coalesce(username, '') into v_role, v_username
        from public.profiles where id = auth.uid();

    perform public.open_financial_year(v_cur, coalesce(v_default, 30),
                                       coalesce(v_role, 'system'), coalesce(v_username, ''));

    perform public.log_action(coalesce(v_role, 'system'), coalesce(v_username, ''),
        'فتح سنة مالية تلقائياً',
        format('فُتحت السنة %s تلقائياً عند دخولها، والسنة السابقة %s سُوّيت وحُفظت في الأرشيف', v_cur, v_max));

    return jsonb_build_object('opened', true, 'year', v_cur, 'previous', v_max);
end;
$$;


-- ---------------------------------------------------------------------
-- 4. GRANTS
-- ---------------------------------------------------------------------
-- The engine is internal; only the two wrappers above may drive it.
revoke all on function public.open_financial_year(text, numeric, text, text) from public;
revoke all on function public.open_financial_year(text, numeric, text, text) from anon;
revoke all on function public.open_financial_year(text, numeric, text, text) from authenticated;

grant execute on function public.add_year(text, numeric)      to authenticated;
grant execute on function public.ensure_current_year()        to authenticated;
