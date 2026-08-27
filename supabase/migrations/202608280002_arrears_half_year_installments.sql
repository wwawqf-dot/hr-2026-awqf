-- =====================================================================
--  Half-year installments, earned IN ARREARS
--  -------------------------------------------------------------------
--  The entitlement is no longer handed out up front. It is earned by
--  serving the months, and credited once each six-month period has
--  actually elapsed:
--
--      1 يناير – 30 يونيو   →  0    (لم ينقضِ شيء بعد)
--      1 يوليو              →  15   (انقضى النصف الأول)
--      31 ديسمبر            →  30   (انقضى النصف الثاني)
--
--  For the over-45 track the same two steps release 22.5 and then 45.
--  The annual total is unchanged — 30 days, or 45 — only the moment it
--  becomes available moves, from the start of the period to its end.
--
--  This supersedes 202608270001, which granted the same two installments
--  but IN ADVANCE, at the start of each half. That migration was undone
--  by 202608280001; this one is the corrected reading of the rule.
--
--  A PAST YEAR IS UNAFFECTED. Its months have all elapsed, so the rule
--  releases the full annual figure for it exactly as before — closed
--  years and their archives keep the numbers they already hold.
--
--  THE CURRENT YEAR DROPS TODAY, BY DESIGN. Applied in August 2026, only
--  the first half of 2026 has elapsed, so every active employee's 2026
--  grant becomes 15 (or 22.5) instead of 30 (or 45). The other half
--  returns on 31 December. This is the owner's explicit instruction,
--  chosen over leaving 2026 on the old rule.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. THE RULE
-- ---------------------------------------------------------------------
-- Months are the unit of account. A month counts once it has been
-- served, and the served months are released in two batches: those of
-- the first half on 1 July, those of the second half on 31 December.
--
-- The annual totals are unchanged by construction. An employee entitled
-- from month `f` through December earns (7-f) twelfths by 1 July and the
-- remaining (13-max(f,7)) twelfths by 31 December, summing to exactly
-- the (13-f) twelfths the single annual grant paid out in one go.
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
    v_last    int;    -- last month ELAPSED and credited, 0..12
    v_year    int;
    v_month   int;
    v_day     int;
begin
    if p_year is null or p_year !~ '^\d{4}$' then return 0; end if;

    -- Tripoli, not UTC: at 23:00 on 30 June the first half has not
    -- finished locally, and a UTC clock would already have said July.
    v_as_of := coalesce(p_as_of, (now() at time zone 'Africa/Tripoli')::date);
    v_year  := extract(year  from v_as_of)::int;
    v_month := extract(month from v_as_of)::int;
    v_day   := extract(day   from v_as_of)::int;

    -- The 45-day track is fixed by regulation; everyone else gets the
    -- allocation configured for that specific year (30 unless changed).
    v_annual := case when coalesce(p_over_45, false)
                     then 45
                     else greatest(0, coalesce(p_default_days, 30)) end;

    -- How many of this year's months have been SERVED and credited.
    if v_year < p_year::int then
        v_last := 0;     -- the year has not begun: nothing earned
    elsif v_year > p_year::int then
        v_last := 12;    -- a past year: fully served, fully credited
    elsif v_month = 12 and v_day = 31 then
        v_last := 12;    -- second half completes on the year's last day
    elsif v_month >= 7 then
        v_last := 6;     -- first half served; second half still running
    else
        v_last := 0;     -- first half still running: nothing earned yet
    end if;

    if v_last = 0 then return 0; end if;

    -- First entitled month: January for anyone already in post, or the
    -- hire month for someone hired during this very year. Joining after
    -- the 15th starts the entitlement the following month.
    v_first := 1;
    if p_hire_date_current_year is not null
       and extract(year from p_hire_date_current_year)::int = p_year::int
    then
        v_first := case when extract(day from p_hire_date_current_year)::int > 15
                        then extract(month from p_hire_date_current_year)::int + 1
                        else extract(month from p_hire_date_current_year)::int end;
        if v_first > 12 then return 0; end if;
    end if;

    -- Hired into the second half, asked before it has elapsed.
    if v_first > v_last then return 0; end if;

    -- round(...,2), not (...,1): the 45-day track's monthly twelfth is
    -- 3.75, and one decimal place would mangle it into 3.8.
    return round((v_last - v_first + 1) * (v_annual / 12.0), 2);
end;
$$;

comment on function public.allocation_due(text, boolean, date, numeric, date) is
    'الرصيد المستحق فعلياً حتى تاريخ معيّن — يُكتسب بعد انقضاء الأشهر: 0 حتى 30 يونيو، ثم نصف الاستحقاق في 1 يوليو، ثم كامله في 31 ديسمبر.';


-- ---------------------------------------------------------------------
-- 2. THE OLD ENTRY POINT, NOW A WRAPPER
-- ---------------------------------------------------------------------
-- Eight call sites across the schema depend on this name and signature —
-- add_year, create_employee, update_employee, register_deduction,
-- reconcile_counters, reconcile_allocations, sync_employees. Replacing
-- the rule underneath them is how none of them gets missed.
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
    'الرصيد المستحق حتى اليوم — يستدعي allocation_due. يُكتسب على دفعتين بعد انقضاء كل ستة أشهر: 1 يوليو و31 ديسمبر.';


-- ---------------------------------------------------------------------
-- 3. RELEASING AN INSTALLMENT ONCE ITS MONTHS HAVE ELAPSED
-- ---------------------------------------------------------------------
-- Idempotent: it compares stored against earned and writes only the
-- difference, so running it a hundred times on 1 July releases the
-- installment exactly once.
--
-- It only ever RAISES a stored figure. This runs on every page load, and
-- a pass that could also lower a balance would silently claw back days
-- an admin had granted by hand. Bringing a figure DOWN is the job of
-- reconcile_allocations(), which only ever runs from a button press.
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
           and ey.year >= v_cur_year
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
-- 4. WHAT THE APP CALLS ON LOAD
-- ---------------------------------------------------------------------
-- Open to any signed-in user rather than admins only, because 1 July and
-- 31 December must release whether or not the admin is the first one
-- through the door that morning. Safe: no arguments, grants strictly
-- what the calendar has already earned, cannot lower or delete anything.
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

    -- Logged only when an installment actually moved. This fires on every
    -- page load; logging unconditionally would bury the activity log in
    -- thousands of "nothing happened" rows and make it useless.
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
-- 5. RECALCULATE THE CURRENT YEAR ONTO THE NEW RULE
-- ---------------------------------------------------------------------
-- The one place in this migration that LOWERS a figure, and the reason
-- the owner was asked before it was written: in August 2026 only the
-- first half has elapsed, so 2026 goes from 30 to 15 (45 to 22.5).
--
-- An employee who has already taken more days than the new figure is
-- left exactly as they are and named in a warning instead. Rewriting
-- them would turn approved, already-taken leave into a debt, and that
-- is a decision for a person, not a migration.
do $$
declare
    v_cur_year text := to_char((now() at time zone 'Africa/Tripoli')::date, 'YYYY');
    v_lowered int := 0;
    v_blocked text;
begin
    with earned as (
        select ey.id, ey.added as stored, ey.deducted,
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
          from earned d
         where ey.id = d.id
           and d.owed is distinct from d.stored
           and d.owed >= d.deducted        -- never below days already taken
        returning 1
    )
    select count(*) into v_lowered from applied;

    select string_agg(format('%s (المسجّل %s / المستحق %s / المخصوم %s)',
                             e.name, ey.added, v.owed, ey.deducted), '، ' order by e.name)
      into v_blocked
      from public.employee_years ey
      join public.employees e on e.id = ey.employee_id
      join public.years     y on y.year = ey.year
      cross join lateral (
           select public.allocation_due(ey.year, e.over_45, e.hire_date_current_year,
                                        coalesce(y.default_days, 30), null) as owed) v
     where e.is_archived = false
       and coalesce(y.is_archived, false) = false
       and ey.year ~ '^\d{4}$'
       and ey.year >= v_cur_year
       and v.owed is distinct from ey.added;

    raise notice 'arrears recalculation: % row(s) updated', v_lowered;
    if v_blocked is not null then
        raise warning 'تعذّر تعديل رصيد الموظفين التالين لأن المستحق أقل من إجازات خُصمت لهم فعلاً — يحتاجون مراجعة يدوية: %', v_blocked;
    end if;
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
