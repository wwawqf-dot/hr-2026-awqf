-- =====================================================================
--  Year-end release, and three hardening fixes around it
--  -------------------------------------------------------------------
--  A review of the arrears allocation turned up one dated, certain data
--  loss and three weaknesses around it. All four are fixed here.
--
--  (1) THE YEAR-END CLIFF — critical, would have fired 1 January 2027.
--      grant_due_installments() and reconcile_allocations() both scanned
--      `year >= current_year`. On 31 December 2026 that includes 2026
--      and the second installment lands; on 1 January 2027 it does not,
--      and 2026 — still holding only its first 15 days — falls out of
--      scope permanently. Every employee would have silently lost half
--      their annual leave (22.5 days on the over-45 track), with no way
--      to recover it: the Settings repair button carried the very same
--      filter, and add_year() would then have folded the short figure
--      into the carry-forward, hiding the loss for good.
--
--      The rule was never wrong — allocation_due() correctly reports the
--      full year for a year already past. Nothing ever asked it. The
--      scan now reaches back one year so a missed 31 December is caught
--      on the next load.
--
--  (2) CLOSING A YEAR EARLY froze whatever had been released so far.
--      add_year() archives the outgoing year; if that happened before
--      31 December the second installment was lost the same way. Closing
--      a year now settles it first.
--
--  (3) A WRITE ON EVERY PAGE LOAD. ensure_allocations_current() took
--      write locks on employee_years for every user on every load, to
--      discover on 363 days out of 365 that there was nothing to do. It
--      now probes read-only first and returns early.
--
--  (4) The scan reaching into last year must never REWRITE last year.
--      For any year before the current one the passes are strictly
--      upward: they may settle a debt, never revise closed history.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. THE RELEASE PASS
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
           and coalesce(y.is_archived, false) = false
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
           and coalesce(y.is_archived, false) = false
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
-- 2. THE REPAIR PASS
-- ---------------------------------------------------------------------
-- Same reach-back, with the asymmetry that makes it safe: the current
-- year may be corrected in either direction, a past year only upward.
-- An admin pressing "مطابقة" should be able to settle a missed year-end
-- release; they should not be able to quietly restate closed history
-- because someone's over-45 flag changed last week.
create or replace function public.reconcile_allocations(p_employee_ids bigint[] default null)
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
    v_fixed    int  := 0;
    v_blocked  jsonb;
begin
    insert into public.employee_years (employee_id, year, added, deducted)
    select e.id, y.year,
           public.year_allocation(y.year, e.over_45, e.hire_date_current_year,
                                  coalesce(y.default_days, 30)), 0
      from public.employees e
      cross join public.years y
     where e.is_archived = false
       and coalesce(y.is_archived, false) = false
       and y.year ~ '^\d{4}$'
       and y.year >= v_cur_year
       and (p_employee_ids is null or e.id = any(p_employee_ids))
       and not exists (select 1 from public.employee_years ey
                        where ey.employee_id = e.id and ey.year = y.year)
    on conflict (employee_id, year) do nothing;
    get diagnostics v_created = row_count;

    with cand as (
        select ey.id, ey.employee_id, ey.year,
               ey.added    as stored,
               ey.deducted as deducted,
               public.year_allocation(ey.year, e.over_45, e.hire_date_current_year,
                                      coalesce(y.default_days, 30)) as owed,
               e.is_unpaid_leave
          from public.employee_years ey
          join public.employees e on e.id = ey.employee_id
          join public.years     y on y.year = ey.year
         where e.is_archived = false
           and coalesce(y.is_archived, false) = false
           and ey.year ~ '^\d{4}$'
           and ey.year >= v_from
           and (p_employee_ids is null or ey.employee_id = any(p_employee_ids))
    ),
    changed as (
        select *, case when is_unpaid_leave and year = v_cur_year
                       then 0 else owed - stored end as delta
          from cand
         where owed is distinct from stored
           and (year >= v_cur_year or owed > stored)   -- past years: upward only
    ),
    solvent as (
        select c.employee_id
          from changed c
         group by c.employee_id
        having public.employee_net_balance(c.employee_id) + sum(c.delta) >= 0
    ),
    applied as (
        update public.employee_years ey
           set added = c.owed
          from changed c
          join solvent s on s.employee_id = c.employee_id
         where ey.id = c.id
        returning 1
    )
    select count(*) into v_fixed from applied;

    select coalesce(jsonb_agg(jsonb_build_object(
               'employee',   e.name,
               'job_number', coalesce(e.job_number, ''),
               'year',       ey.year,
               'stored',     ey.added,
               'correct',    v.owed,
               'deducted',   ey.deducted,
               'net',        public.employee_net_balance(e.id) + (v.owed - ey.added)
           ) order by e.name), '[]'::jsonb)
      into v_blocked
      from public.employee_years ey
      join public.employees e on e.id = ey.employee_id
      join public.years     y on y.year = ey.year
      cross join lateral (
           select public.year_allocation(ey.year, e.over_45, e.hire_date_current_year,
                                         coalesce(y.default_days, 30)) as owed) v
     where e.is_archived = false
       and coalesce(y.is_archived, false) = false
       and ey.year ~ '^\d{4}$'
       and ey.year >= v_cur_year        -- only the live year is reported
       and (p_employee_ids is null or ey.employee_id = any(p_employee_ids))
       and v.owed is distinct from ey.added;

    return jsonb_build_object('created', v_created,
                              'fixed',   v_fixed,
                              'blocked', v_blocked);
end;
$$;


-- ---------------------------------------------------------------------
-- 3. SETTLE THE OUTGOING YEAR BEFORE ARCHIVING IT
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
-- 4. SETTLE ANYTHING ALREADY SHORT
-- ---------------------------------------------------------------------
do $$
declare r jsonb;
begin
    r := public.grant_due_installments();
    raise notice 'year-end release: created=% granted=%', r->>'created', r->>'granted';
end;
$$;
