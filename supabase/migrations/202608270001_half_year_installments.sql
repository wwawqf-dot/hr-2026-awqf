-- =====================================================================
--  Split the annual grant into two half-year installments
--  -------------------------------------------------------------------
--  The yearly entitlement stays exactly what it was — 30 days, or 45 on
--  the over-45 track. What changes is WHEN it lands: half of it is
--  released on 1 January and the other half on 1 July, instead of the
--  whole year arriving in one lump the moment the year is opened.
--
--      عادي      1/1 → +15    1/7 → +15    = 30 سنوياً
--      فوق 45    1/1 → +22.5  1/7 → +22.5  = 45 سنوياً
--
--  DESIGN. Every write site in the schema — add_year, create_employee,
--  update_employee, register_deduction, reconcile_counters,
--  reconcile_allocations, sync_employees — already routes through the
--  single function year_allocation(). Rather than edit eight call sites
--  and risk missing one, the rule itself is replaced underneath them:
--  allocation_due() becomes the engine, and year_allocation() becomes a
--  thin wrapper over it that asks "as of today". Every caller therefore
--  inherits the installment behaviour without being touched.
--
--  NO BALANCE MOVES TODAY. This migration is applied after 1 July 2026,
--  so both of 2026's installments are already due and every active
--  employee's entitlement for the current year computes to exactly the
--  figure they already have. The split first becomes visible on the
--  1 January that opens the next year.
--
--  A YEAR OPENED EARLY NOW STARTS AT ZERO. Opening 2027 in December 2026
--  no longer hands out days that the calendar has not reached; the first
--  installment is released automatically on 1 January. This follows from
--  the grant being date-driven, which is what makes it self-healing.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. THE RULE
-- ---------------------------------------------------------------------
-- Returns the entitlement RELEASED SO FAR for one employee-year: months
-- are the unit of account, the half-year boundaries are the only release
-- points, and a mid-year hire is prorated inside whichever halves they
-- were actually in post for.
--
-- The annual totals are unchanged by construction. An employee entitled
-- from month `f` through December receives (7-f) twelfths in the first
-- installment and (13-max(f,7)) twelfths in the second, which sums to
-- the (13-f) twelfths the single annual grant used to pay.
create or replace function public.allocation_due(
    p_year                   text,
    p_over_45                boolean default false,
    p_hire_date_current_year date    default null,
    p_default_days           numeric default 30,
    p_as_of                  date    default null
) returns numeric
language plpgsql
stable
as $$
declare
    v_annual  numeric;
    v_as_of   date;
    v_first   int;    -- first month the employee is entitled to, 1..12
    v_last    int;    -- last month released as of v_as_of, 0..12
    v_month   int;
    v_day     int;
begin
    if p_year is null or p_year !~ '^\d{4}$' then return 0; end if;

    -- Tripoli, not UTC: on 30 June at 23:00 local the second installment
    -- is not due yet, and a UTC clock would already say July.
    v_as_of := coalesce(p_as_of, (now() at time zone 'Africa/Tripoli')::date);

    -- The 45-day track is fixed by regulation; everyone else gets the
    -- allocation configured for that specific year (30 unless changed).
    v_annual := case when coalesce(p_over_45, false)
                     then 45
                     else greatest(0, coalesce(p_default_days, 30)) end;

    -- How much of this year the calendar has released.
    if extract(year from v_as_of)::int < p_year::int then
        v_last := 0;    -- the year has not started: nothing is owed yet
    elsif extract(year from v_as_of)::int > p_year::int then
        v_last := 12;   -- a past year is closed and fully released
    elsif extract(month from v_as_of)::int >= 7 then
        v_last := 12;   -- second installment released on 1 July
    else
        v_last := 6;    -- first installment only
    end if;

    if v_last = 0 then return 0; end if;

    -- First entitled month: January for anyone already in post, or the
    -- hire month for someone hired during this very year. Joining after
    -- the 15th starts the entitlement the following month.
    v_first := 1;
    if p_hire_date_current_year is not null
       and extract(year from p_hire_date_current_year)::int = p_year::int
    then
        v_month := extract(month from p_hire_date_current_year)::int;
        v_day   := extract(day   from p_hire_date_current_year)::int;
        v_first := case when v_day > 15 then v_month + 1 else v_month end;
        if v_first > 12 then return 0; end if;
    end if;

    -- Hired into the second half, asking during the first: nothing yet.
    if v_first > v_last then return 0; end if;

    -- round(...,2), not (...,1): the 45-day track's monthly twelfth is
    -- 3.75, and one decimal place would mangle it into 3.8.
    return round((v_last - v_first + 1) * (v_annual / 12.0), 2);
end;
$$;

comment on function public.allocation_due(text, boolean, date, numeric, date) is
    'الرصيد المستحق فعلياً حتى تاريخ معيّن: نصف الاستحقاق السنوي في 1 يناير والنصف الآخر في 1 يوليو، مع التناسب لمن عُيّن خلال السنة.';


-- ---------------------------------------------------------------------
-- 2. THE OLD ENTRY POINT, NOW A WRAPPER
-- ---------------------------------------------------------------------
-- Kept deliberately: eight call sites across the schema depend on this
-- name and signature, and rewriting them all is how one gets missed.
create or replace function public.year_allocation(
    p_year                   text,
    p_over_45                boolean default false,
    p_hire_date_current_year date    default null,
    p_default_days           numeric default 30
) returns numeric
language sql
stable
as $$
    select public.allocation_due($1, $2, $3, $4, null);
$$;

comment on function public.year_allocation(text, boolean, date, numeric) is
    'الرصيد المستحق حتى اليوم — يستدعي allocation_due. يُمنح على دفعتين: 1 يناير و1 يوليو.';


-- ---------------------------------------------------------------------
-- 3. RELEASING AN INSTALLMENT WHEN ITS DATE ARRIVES
-- ---------------------------------------------------------------------
-- Idempotent by construction: it compares what is stored against what is
-- due and writes only the difference, so running it twice on 1 July —
-- or a hundred times — releases the installment exactly once.
--
-- It only ever RAISES a stored figure. An admin who granted someone extra
-- days by hand keeps them; this pass will not claw anything back. Pulling
-- a figure back down is reconcile_allocations()' job, and that one is
-- driven by an explicit button press, never by a page load.
create or replace function public.grant_due_installments()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cur_year text := to_char((now() at time zone 'Africa/Tripoli')::date, 'YYYY');
    v_created  int  := 0;
    v_granted  int  := 0;
begin
    -- An active employee with no row for the current year — restored from
    -- the archive after the year was opened — gets one, already carrying
    -- whatever the calendar has released.
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

    with due as (
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
           and ey.year >= v_cur_year
    ),
    applied as (
        update public.employee_years ey
           set added = d.owed
          from due d
         where ey.id = d.id
           and d.owed > d.stored
        returning 1
    )
    select count(*) into v_granted from applied;

    return jsonb_build_object('created', v_created, 'granted', v_granted);
end;
$$;


-- ---------------------------------------------------------------------
-- 4. WHAT THE APP CALLS ON LOAD
-- ---------------------------------------------------------------------
-- Open to any signed-in user rather than admins only, because the release
-- must happen on 1 July whether or not the admin is the first one through
-- the door that morning. That is safe: the function takes no arguments,
-- grants strictly what the calendar already entitles, and cannot reduce
-- a balance or delete anything.
create or replace function public.ensure_allocations_current()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_username text; r jsonb;
begin
    if auth.uid() is null then
        raise exception 'يلزم تسجيل الدخول';
    end if;

    r := public.grant_due_installments();

    -- Logged only when an installment actually moved. This runs on every
    -- page load; logging unconditionally would bury the activity log in
    -- thousands of "nothing happened" entries and make it useless.
    if (r->>'granted')::int > 0 or (r->>'created')::int > 0 then
        select role, coalesce(username, '') into v_role, v_username
            from public.profiles where id = auth.uid();
        perform public.log_action(coalesce(v_role, 'system'), coalesce(v_username, ''),
            'منح دفعة الرصيد المستحقة',
            format('عدد الموظفين الذين مُنحوا: %s، صفوف أُنشئت: %s',
                   r->>'granted', r->>'created'));
    end if;

    return r;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. BRING THE EXISTING DATA IN LINE
-- ---------------------------------------------------------------------
-- Expected to be a no-op on 2026: the migration lands after 1 July, so
-- everyone's due figure equals the full year they already hold. It is
-- here for the years opened ahead of time, and as proof the new rule
-- agrees with the old data rather than quietly disagreeing with it.
do $$
declare r jsonb;
begin
    r := public.grant_due_installments();
    raise notice 'grant_due_installments: created=% granted=%',
        r->>'created', r->>'granted';
end;
$$;


-- ---------------------------------------------------------------------
-- 6. GRANTS
-- ---------------------------------------------------------------------
revoke execute on function public.allocation_due(text, boolean, date, numeric, date) from public;
revoke execute on function public.allocation_due(text, boolean, date, numeric, date) from anon;
grant  execute on function public.allocation_due(text, boolean, date, numeric, date) to authenticated;

-- The release engine is internal; only the wrapper above may drive it.
revoke all on function public.grant_due_installments() from public;
revoke all on function public.grant_due_installments() from anon;
revoke all on function public.grant_due_installments() from authenticated;

grant execute on function public.ensure_allocations_current() to authenticated;
