-- =====================================================================
--  Migration: Soft-delete architecture for employees and financial years
--  ---------------------------------------------------------------------
--  Problem: deleteEmployee() ran a hard `DELETE FROM employees`, which
--  CASCADEs (per the FK definitions) into employee_years and deductions
--  — permanently destroying that employee's entire balance/deduction
--  history. delete_year() did the same directly: hard DELETE on
--  deductions/employee_years/years for that year. Both are irreversible
--  data loss dressed up as a routine admin click.
--
--  Fix: an `is_archived` flag on employees and years. "Delete" now means
--  "flip the flag" — the row, and everything that references it, stays
--  intact. Every read path is updated to filter is_archived = false, so
--  an archived employee/year disappears from every list, dropdown, and
--  print report exactly as if deleted — but an admin can undo a mistake,
--  and no deduction row is ever orphaned or destroyed.
-- =====================================================================

alter table public.employees add column if not exists is_archived boolean not null default false;
alter table public.years add column if not exists is_archived boolean not null default false;

create index if not exists employees_is_archived_idx on public.employees (is_archived);
create index if not exists years_is_archived_idx on public.years (is_archived);

-- ---------------------------------------------------------------------
-- get_employee_json: expose is_archived (round-trip, and for the trash
-- view to render an archived employee's basic info).
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

-- ---------------------------------------------------------------------
-- list_employees: THE global filter point. Every screen (table,
-- dropdowns, print reports, Excel export) reads employees/years through
-- this single RPC, so filtering is_archived here is sufficient to hide
-- archived rows everywhere at once — no need to scatter
-- `.eq('is_archived', false)` across every component individually.
create or replace function public.list_employees()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'employees', coalesce(
            (select jsonb_agg(public.get_employee_json(e.id) order by e.id)
             from public.employees e where e.is_archived = false),
            '[]'::jsonb),
        'years', coalesce(
            (select jsonb_agg(y.year order by cast(y.year as integer))
             from public.years y where y.is_archived = false),
            '[]'::jsonb)
    );
$$;

-- ---------------------------------------------------------------------
-- The trash view (ADMIN only) — what "Delete" now actually does.
create or replace function public.list_archived_employees()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text;
begin
    select role into v_role from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    return jsonb_build_object('employees', coalesce(
        (select jsonb_agg(public.get_employee_json(e.id) order by e.id)
         from public.employees e where e.is_archived = true),
        '[]'::jsonb));
end;
$$;

create or replace function public.list_archived_years()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text;
begin
    select role into v_role from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    return jsonb_build_object('years',
        coalesce((select jsonb_agg(year order by cast(year as integer))
                  from public.years where is_archived = true), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- archive_employee: replaces the hard DELETE FROM employees the client
-- used to issue directly. Nothing under this employee is touched —
-- their employee_years and deductions rows stay exactly as they were.
create or replace function public.archive_employee(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_username text; emp public.employees%rowtype;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    select * into emp from public.employees where id = p_id;
    if not found then raise exception 'الموظف غير موجود'; end if;
    update public.employees set is_archived = true where id = p_id;
    perform public.log_action(v_role, v_username, 'حذف موظف (أرشفة)', format('الموظف: %s', emp.name));
    return jsonb_build_object('message', 'تم حذف الموظف');
end;
$$;

create or replace function public.restore_employee(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_username text; emp public.employees%rowtype;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    select * into emp from public.employees where id = p_id;
    if not found then raise exception 'الموظف غير موجود'; end if;
    update public.employees set is_archived = false where id = p_id;
    perform public.log_action(v_role, v_username, 'استعادة موظف من الأرشيف', format('الموظف: %s', emp.name));
    return jsonb_build_object('employee', public.get_employee_json(p_id));
end;
$$;

-- ---------------------------------------------------------------------
-- add_year: only rejects a duplicate among ACTIVE years now; re-adding a
-- previously archived year restores it (the natural admin expectation)
-- instead of erroring. Every internal loop now also excludes archived
-- employees, so an archived employee never gets a new year's grant.
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
    v_default := coalesce(p_default_days, 30);

    if v_was_archived then
        update public.years set is_archived = false where year = v_year;
    else
        insert into public.years (year) values (v_year);
    end if;

    insert into public.employee_years (employee_id, year, added, deducted)
    select id, v_year, case when over_45 then 45 else v_default end, 0
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

-- ---------------------------------------------------------------------
-- archive_year: replaces delete_year's hard cascade DELETE on
-- deductions/employee_years/years for that year with a flag flip.
create or replace function public.archive_year(p_year text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_username text; v_year text; v_count int;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then raise exception 'هذه العملية مقصورة على المدير'; end if;
    v_year := trim(coalesce(p_year, ''));
    if not exists (select 1 from public.years where year = v_year and is_archived = false) then
        raise exception 'هذه السنة غير موجودة';
    end if;
    select count(*) into v_count from public.years where is_archived = false;
    if v_count <= 1 then raise exception 'لا يمكن حذف آخر سنة مالية متبقية في النظام'; end if;

    update public.years set is_archived = true where year = v_year;

    perform public.log_action(v_role, v_username, 'حذف سنة مالية (أرشفة)', format('السنة: %s', v_year));
    return jsonb_build_object('years',
        coalesce((select jsonb_agg(year order by cast(year as integer))
                  from public.years where is_archived = false), '[]'::jsonb));
end;
$$;

create or replace function public.restore_year(p_year text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_username text; v_year text;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then raise exception 'هذه العملية مقصورة على المدير'; end if;
    v_year := trim(coalesce(p_year, ''));
    if not exists (select 1 from public.years where year = v_year and is_archived = true) then
        raise exception 'هذه السنة ليست في الأرشيف';
    end if;
    update public.years set is_archived = false where year = v_year;
    perform public.log_action(v_role, v_username, 'استعادة سنة مالية من الأرشيف', format('السنة: %s', v_year));
    return jsonb_build_object('years',
        coalesce((select jsonb_agg(year order by cast(year as integer))
                  from public.years where is_archived = false), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- sync_employees: preserve is_archived across JSON export/import, same
-- pattern as every other boolean flag here.
create or replace function public.sync_employees(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text; v_username text;
    v_years jsonb; v_settings jsonb;
    emp jsonb; ded jsonb; yv text; yd_key text; yd_val jsonb;
    v_target bigint; v_created int := 0; v_updated int := 0; v_ded int := 0;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;

    v_years    := coalesce(p_payload->'years', '[]'::jsonb);
    v_settings := p_payload->'settings';

    for yv in select value from jsonb_array_elements_text(v_years) loop
        if yv ~ '^\d{4}$' then
            insert into public.years (year) values (yv) on conflict (year) do nothing;
        end if;
    end loop;

    for emp in select value from jsonb_array_elements(coalesce(p_payload->'employees','[]'::jsonb)) loop
        if coalesce(trim(emp->>'name'), '') = '' then continue; end if;

        v_target := null;
        if nullif(emp->>'id','') is not null then
            select id into v_target from public.employees where id = (emp->>'id')::bigint;
        end if;
        if v_target is null and coalesce(trim(emp->>'job_number'),'') <> '' then
            select id into v_target from public.employees
                where job_number = trim(emp->>'job_number') limit 1;
        end if;

        if v_target is null then
            insert into public.employees
                (id, name, job_number, national_id, job_title, initial_carried_forward, over_45, is_frozen, include_in_print, is_unpaid_leave, is_archived, hire_date, hire_date_current_year, created_at)
            values (
                coalesce(nullif(emp->>'id','')::bigint,
                         nextval(pg_get_serial_sequence('public.employees','id'))),
                trim(emp->>'name'),
                coalesce(trim(emp->>'job_number'),''),
                coalesce(trim(emp->>'national_id'),''),
                coalesce(trim(emp->>'job_title'),''),
                coalesce((emp->>'initial_carried_forward')::numeric, 0),
                coalesce((emp->>'over_45')::boolean, false),
                coalesce((emp->>'is_frozen')::boolean, false),
                coalesce((emp->>'include_in_print')::boolean, true),
                coalesce((emp->>'is_unpaid_leave')::boolean, false),
                coalesce((emp->>'is_archived')::boolean, false),
                coalesce(trim(emp->>'hire_date'),''),
                coalesce(nullif(emp->>'hire_date_current_year',''), null)::date,
                coalesce((emp->>'createdAt')::timestamptz, now())
            ) returning id into v_target;
            v_created := v_created + 1;
        else
            update public.employees set
                name = trim(emp->>'name'),
                job_number  = coalesce(trim(emp->>'job_number'), job_number),
                national_id = coalesce(trim(emp->>'national_id'), national_id),
                job_title   = coalesce(trim(emp->>'job_title'), job_title),
                initial_carried_forward = coalesce((emp->>'initial_carried_forward')::numeric, initial_carried_forward),
                over_45   = coalesce((emp->>'over_45')::boolean, over_45),
                is_frozen = coalesce((emp->>'is_frozen')::boolean, is_frozen),
                include_in_print = coalesce((emp->>'include_in_print')::boolean, include_in_print),
                is_unpaid_leave = coalesce((emp->>'is_unpaid_leave')::boolean, is_unpaid_leave),
                is_archived = coalesce((emp->>'is_archived')::boolean, is_archived),
                hire_date = coalesce(trim(emp->>'hire_date'), hire_date),
                hire_date_current_year = coalesce(nullif(emp->>'hire_date_current_year',''), hire_date_current_year)::date
            where id = v_target;
            v_updated := v_updated + 1;
        end if;

        if emp ? 'years_data' then
            for yd_key, yd_val in select key, value from jsonb_each(emp->'years_data') loop
                if yd_key ~ '^\d{4}$' then
                    insert into public.years (year) values (yd_key) on conflict (year) do nothing;
                    insert into public.employee_years (employee_id, year, added, deducted)
                    values (v_target, yd_key,
                            coalesce((yd_val->>'added')::numeric, 0),
                            coalesce((yd_val->>'deducted')::numeric, 0))
                    on conflict (employee_id, year)
                        do update set added = excluded.added, deducted = excluded.deducted;
                end if;
            end loop;
        end if;

        if emp ? 'deductions_history' then
            for ded in select value from jsonb_array_elements(emp->'deductions_history') loop
                if not (coalesce((ded->>'days')::numeric, 0) > 0) then continue; end if;
                if nullif(ded->>'id','') is not null then
                    insert into public.deductions
                        (id, employee_id, year, start_date, end_date, days, note, created_by, created_at)
                    values ((ded->>'id')::bigint, v_target, coalesce(ded->>'year',''),
                            coalesce(ded->>'start',''), coalesce(ded->>'end',''),
                            (ded->>'days')::numeric,
                            nullif(left(trim(coalesce(ded->>'note','')),500),''),
                            ded->>'createdBy', coalesce((ded->>'createdAt')::timestamptz, now()))
                    on conflict (id) do nothing;
                else
                    insert into public.deductions
                        (employee_id, year, start_date, end_date, days, note, created_by, created_at)
                    values (v_target, coalesce(ded->>'year',''), coalesce(ded->>'start',''),
                            coalesce(ded->>'end',''), (ded->>'days')::numeric,
                            nullif(left(trim(coalesce(ded->>'note','')),500),''),
                            ded->>'createdBy', coalesce((ded->>'createdAt')::timestamptz, now()));
                end if;
                v_ded := v_ded + 1;
            end loop;
        end if;
    end loop;

    if v_settings is not null and (v_settings->>'openingBalanceDate') ~ '^\d{4}-\d{2}-\d{2}$' then
        insert into public.settings (key, value)
        values ('openingBalanceDate', v_settings->>'openingBalanceDate')
        on conflict (key) do update set value = excluded.value;
    end if;

    perform setval(pg_get_serial_sequence('public.employees','id'),
                   (select coalesce(max(id),1) from public.employees),
                   (select count(*) > 0 from public.employees));
    perform setval(pg_get_serial_sequence('public.deductions','id'),
                   (select coalesce(max(id),1) from public.deductions),
                   (select count(*) > 0 from public.deductions));

    perform public.log_action(v_role, v_username, 'مزامنة سحابية (استيراد JSON)',
        format('موظفون جدد: %s، تحديثات: %s، خصومات: %s', v_created, v_updated, v_ded));
    return jsonb_build_object('created', v_created, 'updated', v_updated, 'deductions', v_ded);
end;
$$;

-- ---------------------------------------------------------------------
-- export_all: full backup should still include archived rows (a backup
-- that silently drops archived employees would itself be a data-loss
-- risk) — get_employee_json/list already carries is_archived through,
-- so export_all (which iterates ALL employees, not just active ones)
-- needs no change; confirmed by inspection, no redefinition required.

-- ---------------------------------------------------------------------
-- The "منطقة الخطر" (danger zone) bulk wipe is a deliberately different,
-- explicitly-irreversible admin action from routine single-employee/year
-- deletion — Task 3 only asks to soften THAT. The client used to run this
-- as a raw REST `DELETE FROM employees`; moving it into a SECURITY
-- DEFINER RPC means it keeps working even though the grant below revokes
-- direct DELETE from `authenticated` (a SECURITY DEFINER function runs as
-- its owner, unaffected by the caller's own table grants).
create or replace function public.wipe_all_employees()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_username text;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    delete from public.employees;
    perform public.log_action(v_role, v_username, 'حذف جميع السجلات (منطقة الخطر)', 'تم حذف جميع سجلات الموظفين نهائياً');
    return jsonb_build_object('message', 'تم حذف جميع سجلات الموظفين بنجاح');
end;
$$;

grant execute on function public.wipe_all_employees() to authenticated;
grant execute on function public.list_archived_employees() to authenticated;
grant execute on function public.list_archived_years() to authenticated;
grant execute on function public.archive_employee(bigint) to authenticated;
grant execute on function public.restore_employee(bigint) to authenticated;
grant execute on function public.archive_year(text) to authenticated;
grant execute on function public.restore_year(text) to authenticated;

-- Retire the destructive path outright, not just by convention: the old
-- delete_year() hard-cascaded deletes and must never be callable again
-- now that archive_year() is the sanctioned replacement.
drop function if exists public.delete_year(text);

-- Close the bypass this whole migration exists to prevent: the
-- `employees_admin_write`/`years_admin_write` RLS policies are `for all`
-- (select+insert+update+delete), so even after the client switches to
-- archive_employee()/archive_year(), an admin session could still issue
-- a raw REST `.delete()` against these tables directly and cascade the
-- exact data loss this migration fixes. Revoking the DELETE grant closes
-- that off at the privilege-check layer, before RLS is even evaluated —
-- independent of what any RLS policy allows. archive/restore use UPDATE,
-- so they are entirely unaffected by this.
revoke delete on public.employees from authenticated;
revoke delete on public.years from authenticated;
