-- =====================================================================
--  Remove the half-year installments — back to one annual grant
--  -------------------------------------------------------------------
--  202608270001 split the yearly entitlement into two releases, on
--  1 January and 1 July. The owner asked for that to be taken out, so
--  the whole year is again granted in a single batch the moment the
--  financial year is opened:
--
--      عادي      1/1 → +30    (دفعة واحدة)
--      فوق 45    1/1 → +45    (دفعة واحدة)
--
--  Written as a forward migration rather than by deleting the file it
--  undoes. Deleting an applied migration leaves the remote history
--  pointing at a file that no longer exists, and if it was never applied
--  this one is simply a harmless no-op that restores the rule already in
--  force. Either way the database lands in the same place.
--
--  The annual total is untouched: 30 days, or 45 on the over-45 track,
--  exactly as before the split. Only the timing reverts.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. RESTORE THE ANNUAL RULE
-- ---------------------------------------------------------------------
-- Byte-for-byte the definition from 202608250001. The eight call sites
-- across the schema (add_year, create_employee, update_employee,
-- register_deduction, reconcile_counters, reconcile_allocations,
-- sync_employees) all route through this one name, so restoring it here
-- restores every one of them without touching any of them.
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
    'الرصيد السنوي الكامل يُمنح دفعة واحدة عند فتح السنة: 30 يوماً (أو 45 لمن هم فوق 45 سنة)، وبالتناسب لمن عُيّن خلال السنة.';


-- ---------------------------------------------------------------------
-- 2. TOP UP ANYTHING THE SPLIT LEFT SHORT
-- ---------------------------------------------------------------------
-- If the installment rule was ever live, a row could be holding half a
-- year (or nothing, for a year opened ahead of time). Raise those to the
-- full annual grant. Never lowers a figure: an admin who granted extra
-- days by hand keeps them.
do $$
declare v_cur_year text := to_char((now() at time zone 'Africa/Tripoli')::date, 'YYYY');
        v_fixed int := 0;
begin
    with due as (
        select ey.id, ey.added as stored,
               public.year_allocation(ey.year, e.over_45, e.hire_date_current_year,
                                      coalesce(y.default_days, 30)) as owed
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
         where ey.id = d.id and d.owed > d.stored
        returning 1
    )
    select count(*) into v_fixed from applied;
    raise notice 'restored to full annual grant: % row(s)', v_fixed;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. DROP THE INSTALLMENT MACHINERY
-- ---------------------------------------------------------------------
-- Dropped last, so the top-up above ran while everything still existed.
-- `if exists` because this migration must also be a clean no-op on a
-- database where 202608270001 never landed.
drop function if exists public.ensure_allocations_current();
drop function if exists public.grant_due_installments();
drop function if exists public.allocation_due(text, boolean, date, numeric, date);
