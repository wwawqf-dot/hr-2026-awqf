-- =====================================================================
--  The balance guard must honour the ceiled carry-over, as the table does
--  -------------------------------------------------------------------
--  add_year() deliberately rounds the carried-forward balance UP when it
--  opens a year, and stores it:
--
--      ceiled_cumulative_balance = ceil(v_running)
--      carryover_ceiled_at_year  = the year being opened
--
--  computeYearlyLedger() — the "الصافي التراكمي" column every admin reads
--  — takes that ceiled figure AS the opening balance from that year on.
--  employee_net_balance() does not: it re-derives the balance from
--  initial_carried_forward plus every year's (added - deducted), which is
--  the RAW running total the ceiling was applied to.
--
--  So the two disagree by the fraction the ceiling added, and they
--  disagree in the worst possible direction — the screen shows MORE than
--  the guard will allow:
--
--      جدول الموظفين يعرض   23
--      حارس الخصم يسمح بـ   22.5
--
--  An admin reading 23 and entering 23 is refused by a guard quoting a
--  number that appears nowhere on screen. Fractions are routine here:
--  every over-45 half-year installment is 22.5, and every prorated hire
--  year lands on quarter days.
--
--  The ceiling is policy, not an accident — it rounds in the employee's
--  favour once a year — so the fix makes the guard agree with the ledger
--  rather than stripping the rounding out of the display.
-- =====================================================================

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

    if emp.carryover_ceiled_at_year is not null
       and emp.ceiled_cumulative_balance is not null
    then
        -- Start from the ceiled carry-over and count only the years from
        -- the ceiling forward — precisely what computeYearlyLedger does
        -- when it swaps `opening` for the ceiled figure and carries on.
        -- Counting earlier years again here would add the very balance
        -- the ceiled figure already represents.
        select emp.ceiled_cumulative_balance
             + coalesce(sum(
                   case when ey.year = v_cur_year and emp.is_unpaid_leave
                        then 0 else coalesce(ey.added, 0) end
                   - coalesce(ey.deducted, 0)), 0)
          into v_balance
          from public.employee_years ey
         where ey.employee_id = p_employee_id
           and ey.year >= emp.carryover_ceiled_at_year;
    else
        select coalesce(emp.initial_carried_forward, 0)
             + coalesce(sum(
                   case when ey.year = v_cur_year and emp.is_unpaid_leave
                        then 0 else coalesce(ey.added, 0) end
                   - coalesce(ey.deducted, 0)), 0)
          into v_balance
          from public.employee_years ey
         where ey.employee_id = p_employee_id;
    end if;

    return round(v_balance, 2);
end;
$$;

comment on function public.employee_net_balance(bigint) is
    'الرصيد المتاح للموظف — يطابق عمود "الصافي التراكمي" في الجدول، بما في ذلك تسقيف الرصيد المرحّل عند فتح السنة.';

grant execute on function public.employee_net_balance(bigint) to authenticated;
