-- =====================================================================
--  Migration: Employee print toggle + unpaid leave
--  1. Add include_in_print column (controls print visibility when frozen)
--  2. Add is_unpaid_leave column (zeroes out all balances)
--  3. Update toggle_employee_freeze to accept include_in_print
-- =====================================================================

alter table public.employees
    add column if not exists include_in_print boolean not null default true,
    add column if not exists is_unpaid_leave boolean not null default false;

-- Update toggle_employee_freeze to honour include_in_print preference
create or replace function public.toggle_employee_freeze(
    p_id bigint,
    p_include_in_print boolean default true
)
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
    select * into emp from public.employees where id = p_id for update;
    if not found then raise exception 'الموظف غير موجود'; end if;

    if emp.is_frozen then
        update public.employees set is_frozen = false, include_in_print = true where id = p_id;
    else
        update public.employees set is_frozen = true, include_in_print = p_include_in_print where id = p_id;
    end if;
    perform public.log_action(v_role, v_username,
        case when emp.is_frozen then 'إلغاء تجميد موظف' else 'تجميد موظف' end,
        format('الموظف: %s', emp.name));
    return jsonb_build_object('employee', public.get_employee_json(p_id));
end;
$$;

grant execute on function public.toggle_employee_freeze(bigint, boolean) to authenticated;
revoke execute on function public.toggle_employee_freeze(bigint) from authenticated;
