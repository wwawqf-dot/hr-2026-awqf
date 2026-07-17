-- =====================================================================
--  نشر كامل لكل العناصر المفقودة:
--  1. جدول invite_codes
--  2. الدوال create_auth_user / delete_auth_user
--  3. صلاحيات RLS
--  4. إعدادات Auth (تعطيل تأكيد البريد)
-- =====================================================================
--  شغّل هذا الملف في Supabase Dashboard:
--  SQL Editor → استيراد الملف → Run
-- =====================================================================

-- ============================================================
--  1. جدول رموز الدعوة
-- ============================================================
create table if not exists public.invite_codes (
    code       text primary key,
    role       text not null check (role in ('data_entry', 'viewer')),
    is_used    boolean not null default false,
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now()
);

alter table public.invite_codes enable row level security;

-- أي مستخدم مسجل يمكنه قراءة الرموز (للتحقق من الصلاحية)
drop policy if exists invite_codes_select on public.invite_codes;
create policy invite_codes_select on public.invite_codes
    for select to authenticated using (true);

-- فقط المدير يمكنه إدراج/تحديث/حذف
drop policy if exists invite_codes_admin_write on public.invite_codes;
create policy invite_codes_admin_write on public.invite_codes
    for all to authenticated
    using (public.current_app_role() = 'admin')
    with check (public.current_app_role() = 'admin');

-- ============================================================
--  2. دوال إدارة المستخدمين (للمدير)
-- ============================================================

-- إنشاء مستخدم (بديل GoTrue Admin API من المتصفح)
create or replace function public.create_auth_user(
    p_email    text,
    p_password text,
    p_role     text default 'data_entry'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_enc_pw  text;
begin
    if public.current_app_role() != 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    if p_role not in ('data_entry', 'viewer') then
        raise exception 'الصلاحية غير صالحة. يجب أن تكون data_entry أو viewer.';
    end if;
    if exists (select 1 from auth.users where email = p_email) then
        raise exception 'المستخدم % موجود مسبقاً', p_email;
    end if;

    v_user_id := gen_random_uuid();
    v_enc_pw  := crypt(p_password, gen_salt('bf'));

    insert into auth.users (
        id, instance_id, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token,
        is_super_admin, role
    ) values (
        v_user_id,
        '00000000-0000-0000-0000-000000000000',
        p_email,
        v_enc_pw,
        now(),
        jsonb_build_object('provider', 'email', 'providers', array['email']),
        jsonb_build_object('role', p_role, 'username', split_part(p_email, '@', 1)),
        now(), now(),
        '', '', '', '',
        false, 'authenticated'
    );

    insert into auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
        v_user_id,
        v_user_id,
        jsonb_build_object('sub', v_user_id, 'email', p_email),
        'email',
        p_email,
        now(), now(), now()
    );

    return json_build_object('id', v_user_id::text, 'email', p_email, 'role', p_role);
end;
$$;

-- حذف مستخدم
create or replace function public.delete_auth_user(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.current_app_role() != 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    if not exists (select 1 from auth.users where id = p_id) then
        raise exception 'المستخدم غير موجود';
    end if;
    delete from auth.users where id = p_id;
end;
$$;

-- منح صلاحية تنفيذ الدوال
grant execute on function public.create_auth_user(text, text, text)   to authenticated;
grant execute on function public.delete_auth_user(uuid)               to authenticated;

-- ============================================================
--  3. تحديث صلاحية handle_new_user trigger
--     (للتأكد من أن صلاحية المستخدمين الجدد تأتي من metadata)
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, username, role)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'username', new.email),
        coalesce(new.raw_user_meta_data->>'role', 'viewer')
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

-- Trigger: sync auth.users → profiles on insert
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ============================================================
--  4. دوال رموز الدعوة
-- ============================================================
create or replace function public.generate_invite_code(p_role text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_code text;
begin
    if public.current_app_role() != 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    if p_role not in ('data_entry', 'viewer') then
        raise exception 'الصلاحية غير صالحة';
    end if;
    v_code := 'WQF-' || upper(encode(gen_random_bytes(5), 'hex'));
    insert into public.invite_codes (code, role, created_by)
    values (v_code, p_role, auth.uid());
    return v_code;
end;
$$;

create or replace function public.validate_invite_code(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text;
begin
    select role into v_role
    from public.invite_codes
    where code = p_code and is_used = false;
    if not found then
        raise exception 'رمز الدعوة غير صالح أو تم استخدامه مسبقاً';
    end if;
    return v_role;
end;
$$;

create or replace function public.consume_invite_code(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.invite_codes set is_used = true
    where code = p_code and is_used = false;
    if not found then
        raise exception 'رمز الدعوة غير صالح أو تم استخدامه مسبقاً';
    end if;
end;
$$;

grant execute on function public.generate_invite_code(text) to authenticated;
grant execute on function public.validate_invite_code(text) to authenticated;
grant execute on function public.consume_invite_code(text) to authenticated;

-- ============================================================
--  5. إعدادات Auth — تعطيل تأكيد البريد الإلكتروني
-- ============================================================
--  ارجع إلى Dashboard ← Authentication ← Settings
--  واجعل "Confirm email" = OFF (مطفأ)
--  الرابط المباشر:
--  https://supabase.com/dashboard/project/uzmhsesmszngkanjsjgy/auth/settings
-- ============================================================

-- ============================================================
--  6. عمود deduction_source + FIFO tracking + hire_date_current_year
-- ============================================================
alter table public.deductions
    add column if not exists deduction_source text default null;

-- عمود تاريخ المباشرة للمعينين حديثاً (للاحتساب النسبي)
alter table public.employees
    add column if not exists hire_date_current_year date default null;

-- أعمدة تقريب الرصيد التراكمي عند فتح سنة مالية جديدة (CEIL)
alter table public.employees
    add column if not exists ceiled_cumulative_balance numeric default null,
    add column if not exists carryover_ceiled_at_year text default null;

-- أعمدة التحكم بالطباعة وإجازة بدون مرتب
alter table public.employees
    add column if not exists include_in_print boolean not null default true,
    add column if not exists is_unpaid_leave boolean not null default false;

create or replace function public.register_deduction(p_employee_id bigint, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text; v_username text; emp public.employees%rowtype;
    v_has_dates boolean; v_has_unknown boolean;
    v_years text[]; v_latest text; v_start_year text;
    v_year text; v_days numeric; v_start text := ''; v_end text := '';
    v_retro int; v_net numeric; v_note text;
    v_prev_carry numeric; v_fifo_source text;
    v_curr_year text; v_curr_month int;
    v_months int; v_monthly_rate numeric; v_dynamic_added numeric;
    v_hire_date date; v_diff_days int;
    p_start text := nullif(p_payload->>'start', '');
    p_end   text := nullif(p_payload->>'end', '');
    p_holidays numeric := coalesce((p_payload->>'customHolidays')::numeric, 0);
    v_cutoff_month int; v_hire_month int; v_hire_day int;
    p_unknown  text := nullif(trim(coalesce(p_payload->>'unknownDays','')), '');
begin
    if auth.uid() is null then raise exception 'غير مصرح'; end if;
    select role, coalesce(username, '') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is null then raise exception 'الحساب غير مُهيأ'; end if;
    select * into emp from public.employees where id = p_employee_id for update;
    if not found then raise exception 'الموظف غير موجود'; end if;
    v_note := nullif(left(trim(coalesce(p_payload->>'note','')), 500), '');
    select array_agg(year order by cast(year as integer)) into v_years from public.years;
    if v_years is null then raise exception 'لا توجد سنة مالية نشطة لتسجيل الخصم'; end if;
    v_latest := v_years[array_length(v_years, 1)];
    v_has_dates   := (p_start is not null and p_end is not null);
    v_has_unknown := (p_unknown is not null);
    if v_has_dates then
        v_start_year := split_part(p_start, '-', 1);
        if not (v_start_year = any(v_years)) then
            raise exception 'لا توجد سنة مالية نشطة مطابقة لتاريخ البداية (%)', v_start_year;
        end if;
        v_year := v_start_year;
        v_days := public.calculate_deduction_days(p_start, p_end, p_holidays, coalesce(emp.job_title,''));
        if v_days <= 0 then raise exception 'يجب أن يكون عدد أيام الخصم أكبر من صفر'; end if;
        v_retro := ((now() at time zone 'Africa/Tripoli')::date - p_start::date);
        if v_retro > 40 then raise exception 'لا يمكن تسجيل إجازة بتاريخ رجعي يتجاوز 40 يوماً من تاريخ النظام الحالي.'; end if;
        v_start := p_start; v_end := p_end;
    elsif v_has_unknown then
        v_days := p_unknown::numeric;
        if not (v_days > 0) then raise exception 'يرجى إدخال عدد أيام صحيح أكبر من صفر'; end if;
        v_year := v_latest;
    else
        raise exception 'يرجى تحديد تاريخ البداية والنهاية أو عدد أيام الخصم';
    end if;
    -- Dynamic accrual (no hardcoded 30/45)
    v_curr_year := extract(year from now() at time zone 'Africa/Tripoli')::text;
    v_curr_month := extract(month from now() at time zone 'Africa/Tripoli');
    v_monthly_rate := case when emp.over_45 then 3.75 else 2.5 end;
    if v_year < v_curr_year then v_months := 12;
    elsif emp.hire_date_current_year is not null and v_year = v_curr_year then
        v_cutoff_month := v_curr_month - 1;
        v_hire_month := extract(month from emp.hire_date_current_year);
        v_hire_day := extract(day from emp.hire_date_current_year);
        if v_hire_month > v_cutoff_month then v_months := 0;
        else
            if v_hire_day > 15 then v_hire_month := v_hire_month + 1; end if;
            if v_hire_month > v_cutoff_month then v_months := 0;
            else v_months := v_cutoff_month - v_hire_month + 1;
            end if;
        end if;
    else v_months := greatest(0, v_curr_month - 1); end if;
    v_dynamic_added := round((v_months * v_monthly_rate)::numeric, 1);
    -- Balance check (include dynamic accrual if row doesn't exist yet)
    select coalesce(emp.initial_carried_forward, 0) + coalesce(sum(coalesce(added,0) - coalesce(deducted,0)), 0)
         + case when not exists (select 1 from public.employee_years where employee_id = emp.id and year = v_year)
                then v_dynamic_added else 0 end
      into v_net from public.employee_years where employee_id = emp.id;
    if v_days > v_net then
        raise exception 'فشلت العملية: رصيد الموظف الحالي غير كافٍ لتغطية عدد أيام الخصم المطلوبة.';
    end if;
    -- FIFO source
    select coalesce(emp.initial_carried_forward, 0) + coalesce(sum(coalesce(added,0) - coalesce(deducted,0)), 0)
      into v_prev_carry from public.employee_years where employee_id = emp.id and year < v_year;
    v_prev_carry := greatest(0, v_prev_carry);
    if v_prev_carry <= 0 then v_fifo_source := 'حالي';
    elsif v_days <= v_prev_carry then v_fifo_source := 'سابق';
    else v_fifo_source := 'موزع';
    end if;
    insert into public.employee_years (employee_id, year, added, deducted)
    values (emp.id, v_year, v_dynamic_added, 0)
    on conflict (employee_id, year) do nothing;
    update public.employee_years set deducted = deducted + v_days
        where employee_id = emp.id and year = v_year;
    if coalesce((select coalesce(emp.initial_carried_forward,0) + sum(coalesce(added,0) - coalesce(deducted,0))
           from public.employee_years where employee_id = emp.id), 0) < 0 then
        raise exception 'خطأ داخلي: الرصيف سالب بعد الخصم - تم إلغاء العملية';
    end if;
    insert into public.deductions (employee_id, year, start_date, end_date, days, note, created_by, created_at, deduction_source)
    values (emp.id, v_year, v_start, v_end, v_days, v_note, v_username, now(), v_fifo_source);
    perform public.log_action(v_role, v_username, 'تسجيل خصم إجازة',
        format('تم خصم %s يوم من رصيد %s لسنة %s%s', v_days, emp.name, v_year,
               case when v_has_dates then '' else ' (بدون تاريخ محدد)' end));
    return jsonb_build_object('employee', public.get_employee_json(emp.id));
end;
$$;

create or replace function public.get_employee_json(p_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'id', e.id, 'name', e.name, 'job_number', coalesce(e.job_number, ''),
        'national_id', coalesce(e.national_id, ''), 'job_title', coalesce(e.job_title, ''),
        'initial_carried_forward', e.initial_carried_forward, 'over_45', e.over_45,
        'is_frozen', e.is_frozen, 'include_in_print', e.include_in_print,
        'is_unpaid_leave', e.is_unpaid_leave, 'hire_date', coalesce(e.hire_date, ''),
        'hire_date_current_year', e.hire_date_current_year,
        'ceiled_cumulative_balance', e.ceiled_cumulative_balance,
        'carryover_ceiled_at_year', e.carryover_ceiled_at_year,
        'years_data', coalesce((
            select jsonb_object_agg(ey.year, jsonb_build_object('added', ey.added, 'deducted', ey.deducted))
            from public.employee_years ey where ey.employee_id = e.id
        ), '{}'::jsonb),
        'deductions_history', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', d.id, 'year', d.year, 'start', d.start_date, 'end', d.end_date,
                       'days', d.days, 'note', d.note, 'createdBy', d.created_by,
                       'createdAt', d.created_at, 'deductionSource', d.deduction_source
                   ) order by d.id)
            from public.deductions d where d.employee_id = e.id
        ), '[]'::jsonb),
        'createdAt', e.created_at
    )
    from public.employees e where e.id = p_id;
$$;

-- Update add_year to CEIL running balance and record the boundary year
create or replace function public.add_year(p_year text, p_default_days numeric default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_username text; v_year text; v_default numeric;
    emp record;
    v_running numeric;
begin
    select role, coalesce(username,'') into v_role, v_username
        from public.profiles where id = auth.uid();
    if v_role is distinct from 'admin' then raise exception 'هذه العملية مقصورة على المدير'; end if;
    v_year := trim(coalesce(p_year, ''));
    if v_year !~ '^\d{4}$' then raise exception 'يرجى إدخال سنة مالية صحيحة'; end if;
    if exists (select 1 from public.years where year = v_year) then
        raise exception 'هذه السنة مسجلة مسبقاً';
    end if;
    v_default := coalesce(p_default_days, 30);
    insert into public.years (year) values (v_year);
    insert into public.employee_years (employee_id, year, added, deducted)
    select id, v_year, case when over_45 then 45 else v_default end, 0 from public.employees
    on conflict (employee_id, year) do nothing;
    for emp in select e.id, e.initial_carried_forward from public.employees e loop
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
        coalesce((select jsonb_agg(year order by cast(year as integer)) from public.years), '[]'::jsonb));
end;
$$;

-- ============================================================
--  8. Super Admin protection layer
-- ============================================================

-- Add email column to profiles for super admin identification
alter table public.profiles
    add column if not exists email text default null;

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

alter table public.profiles
    alter column email set not null,
    add constraint profiles_email_unique unique (email);

-- Re-define handle_new_user to include email (must come AFTER the column is added)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, username, role, email)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
        coalesce(new.raw_user_meta_data->>'role', 'viewer'),
        new.email
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

-- Super admin email constant
create or replace function public.super_admin_email()
returns text
language sql
immutable
as $$
    select 'abdo.shta@gmail.com'::text;
$$;

-- Update delete_auth_user with super admin block
create or replace function public.delete_auth_user(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_target_email text;
begin
    if public.current_app_role() != 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    select email into v_target_email from public.profiles where id = p_id;
    if not found then
        raise exception 'المستخدم غير موجود';
    end if;
    if v_target_email = public.super_admin_email() then
        raise exception 'لا يمكن حذف المدير الأساسي للنظام';
    end if;
    delete from auth.users where id = p_id;
end;
$$;

-- update_user_role RPC with super admin protection
create or replace function public.update_user_role(p_user_id uuid, p_new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_target_email text;
begin
    if public.current_app_role() != 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    if p_new_role not in ('admin', 'data_entry', 'viewer') then
        raise exception 'الصلاحية غير صالحة';
    end if;
    select email into v_target_email from public.profiles where id = p_user_id;
    if not found then
        raise exception 'المستخدم غير موجود';
    end if;
    if v_target_email = public.super_admin_email() then
        raise exception 'لا يمكن تعديل صلاحية المدير الأساسي للنظام';
    end if;
    update public.profiles set role = p_new_role where id = p_user_id;
end;
$$;

grant execute on function public.update_user_role(uuid, text) to authenticated;

-- ============================================================
--  تم الانتهاء من النشر
--  تحقق من absence of errors في الأسفل
-- ============================================================
