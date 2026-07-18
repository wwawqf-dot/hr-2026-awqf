-- =====================================================================
--  Migration: Security review hardening
--  ---------------------------------------------------------------------
--  Two RLS gaps found in a manual security review:
--
--  1) invite_codes allowed ANY authenticated role (including 'viewer',
--     the lowest-privilege role) to INSERT/UPDATE rows directly over
--     REST, bypassing the admin-only generate_invite_code() RPC. A
--     'viewer' could mint their own data_entry-level invite codes,
--     revive an already-used code, or upgrade a pending code's role.
--
--  2) employees/years/employee_years/deductions SELECT policies were
--     `using (true)` with no is_archived filter, so the "archived items
--     vanish everywhere" guarantee only held through list_employees() —
--     a direct table read by any authenticated role still returned
--     archived rows. list_archived_employees()/list_archived_years()
--     remain unaffected (SECURITY DEFINER functions run as the table
--     owner and bypass RLS), so the admin trash-bin UI keeps working.
-- =====================================================================

drop policy if exists "authenticated can insert invite_codes" on public.invite_codes;
drop policy if exists "authenticated can update invite_codes" on public.invite_codes;

create policy "admin can insert invite_codes"
    on public.invite_codes for insert
    to authenticated
    with check (public.current_app_role() = 'admin');

create policy "admin can update invite_codes"
    on public.invite_codes for update
    to authenticated
    using (public.current_app_role() = 'admin')
    with check (public.current_app_role() = 'admin');

drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees for select to authenticated using (is_archived = false);

drop policy if exists years_select on public.years;
create policy years_select on public.years for select to authenticated using (is_archived = false);

drop policy if exists employee_years_select on public.employee_years;
create policy employee_years_select on public.employee_years for select to authenticated
    using (exists (
        select 1 from public.employees e
        where e.id = employee_years.employee_id and e.is_archived = false
    ));

drop policy if exists deductions_select on public.deductions;
create policy deductions_select on public.deductions for select to authenticated
    using (exists (
        select 1 from public.employees e
        where e.id = deductions.employee_id and e.is_archived = false
    ));
