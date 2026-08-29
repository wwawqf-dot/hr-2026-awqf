-- =====================================================================
--  A deduction on a closed year must still move the balance
--  -------------------------------------------------------------------
--  Opening a financial year froze the carried-forward balance into one
--  absolute number:
--
--      ceiled_cumulative_balance = ceil(initial + Σ(years before it))
--
--  and employee_net_balance() then read that figure and added only the
--  years FROM the ceiling onwards. Every year before it was represented
--  solely by that frozen total.
--
--  So a leave running 20/12/2026 → 10/01/2027 — charged to 2026, which is
--  correct, since the leave began there — was written into a year the
--  balance had stopped looking at. Measured on the real code:
--
--      قبل التسجيل   2026 مخصوم  0   الصافي 484   الحارس يسمح بـ 484
--      بعد 14 يوماً  2026 مخصوم 14   الصافي 484   الحارس يسمح بـ 484
--
--  Fourteen days taken, nothing deducted, and the deduction visible in
--  its own column while changing no total on the page.
--
--  THE FIX. Keep the ceiling — it is a real policy, rounding up in the
--  employee's favour once a year — but store what it actually IS: a
--  rounding of less than one day, held as a constant. The balance then
--  becomes
--
--      initial + Σ(ALL years) + carryover_rounding
--
--  which produces the identical figure while leaving every year live. A
--  correction to a closed year flows through on its own, because nothing
--  is frozen any more except the fraction.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. THE CONSTANT
-- ---------------------------------------------------------------------
alter table public.employees
    add column if not exists carryover_rounding numeric not null default 0;

comment on column public.employees.carryover_rounding is
    'كسر التقريب المحفوظ عند فتح السنة (أقل من يوم) — يُضاف للرصيد بدل تجميد مجموع السنوات السابقة.';


-- ---------------------------------------------------------------------
-- 2. RE-DERIVE IT FROM CURRENT DATA
-- ---------------------------------------------------------------------
-- Recomputed from the live years rather than back-solved out of the old
-- frozen figure: back-solving would preserve the drift instead of
-- removing it, since any deduction already lost to this bug is exactly
-- the difference between the two. Re-deriving repairs those employees.
update public.employees e
   set carryover_rounding = greatest(0, least(1, ceil(v.running) - v.running)),
       ceiled_cumulative_balance = ceil(v.running)
  from (
      select e2.id,
             coalesce(e2.initial_carried_forward, 0) + coalesce((
                 select sum(coalesce(ey.added, 0) - coalesce(ey.deducted, 0))
                   from public.employee_years ey
                  where ey.employee_id = e2.id
                    and ey.year < e2.carryover_ceiled_at_year), 0) as running
        from public.employees e2
       where e2.carryover_ceiled_at_year is not null
  ) v
 where e.id = v.id;


-- ---------------------------------------------------------------------
-- 3. THE BALANCE, WITH EVERY YEAR LIVE AGAIN
-- ---------------------------------------------------------------------
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

    -- Every year counts, always. The ceiling contributes only its fraction,
    -- so correcting a closed year moves this figure the way it should.
    select coalesce(emp.initial_carried_forward, 0)
         + case when emp.carryover_ceiled_at_year is not null
                then coalesce(emp.carryover_rounding, 0) else 0 end
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

comment on function public.employee_net_balance(bigint) is
    'الرصيد المتاح للموظف — يطابق عمود "الصافي التراكمي" في الجدول، ويشمل كسر التقريب المحفوظ عند فتح السنة.';

grant execute on function public.employee_net_balance(bigint) to authenticated;


-- ---------------------------------------------------------------------
-- 4. WRITE THE CONSTANT WHEN A YEAR IS OPENED
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
            -- The rounding as a CONSTANT, which is what makes the carry-over
            -- survive a later edit to a year that closed before it. Storing
            -- only the absolute ceil(v_running) froze the sum of every prior
            -- year into one number: a December leave recorded in January
            -- then landed in a year the balance no longer looked at, and the
            -- employee spent days that never left their balance.
            carryover_rounding = ceil(v_running) - v_running,
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
-- 5. HAND IT TO THE CLIENT
-- ---------------------------------------------------------------------
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
        'carryover_rounding', coalesce(e.carryover_rounding, 0),
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
                       'deductionSource', d.deduction_source
                   ) order by d.id)
            from public.deductions d where d.employee_id = e.id
        ), '[]'::jsonb),
        'createdAt', e.created_at
    )
    from public.employees e where e.id = p_id;
$$;
