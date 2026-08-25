-- =====================================================================
--  The opening balance counted the new year's own grant twice
--  -------------------------------------------------------------------
--  add_year() grants the year to every employee, and then records what
--  they carried into it as employees.ceiled_cumulative_balance (rounded
--  up, CEIL, in the employee's favour). computeYearlyLedger() reads that
--  figure AS the opening of that year and then adds the year's `added`
--  on top of it.
--
--  But the running total was summed over EVERY employee_years row — and
--  the row for the year being opened had just been inserted, seconds
--  earlier, carrying that year's full 30 or 45 days. So the grant landed
--  in the opening balance, and the ledger added it again:
--
--      stored:  ceiled = initial + (2025: 30) + (2026: 30) = 60
--      ledger:  2026 opening 60 + added 30 = closing 90
--      truth:   initial + 30 + 30 = 60
--
--  Nobody could overspend on it — the deduction guard runs off
--  employee_net_balance(), which sums the raw rows and never consults
--  the ceiled figure — but the "الصافي التراكمي" column promised every
--  employee one whole annual grant more than they had, from the moment
--  their financial year was opened.
--
--  The fix is one predicate: sum only the years that closed BEFORE the
--  one being opened. Part 2 then rewrites the figures already stored
--  under the old rule.
--
--  Note this is a long-standing defect, not a consequence of the move to
--  manual allocation. The old accrual engine stored the same full 30/45
--  in employee_years.added, so the same grant was double-counted then
--  too; manual allocation only made the stored numbers visible enough to
--  notice it.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. THE RULE
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
-- 2. REPAIR WHAT IS ALREADY STORED
-- ---------------------------------------------------------------------
-- Recompute every ceiled opening from the years that genuinely precede
-- the year it was stamped against. Archived employees are included: the
-- figure has to be right for them too, or restoring one would resurrect
-- the inflated balance.
do $$
declare v_fixed int;
begin
    with corrected as (
        select e.id,
               e.ceiled_cumulative_balance as old_opening,
               ceil(coalesce(e.initial_carried_forward, 0)
                  + coalesce((select sum(coalesce(ey.added, 0) - coalesce(ey.deducted, 0))
                                from public.employee_years ey
                               where ey.employee_id = e.id
                                 and ey.year < e.carryover_ceiled_at_year), 0)) as new_opening
          from public.employees e
         where e.carryover_ceiled_at_year is not null
    ),
    applied as (
        update public.employees e
           set ceiled_cumulative_balance = c.new_opening
          from corrected c
         where e.id = c.id
           and c.new_opening is distinct from c.old_opening
        returning 1
    )
    select count(*) into v_fixed from applied;

    raise notice 'ceiled opening balances corrected: %', v_fixed;
end;
$$;
