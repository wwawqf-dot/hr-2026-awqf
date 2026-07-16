-- =====================================================================
--  One-time deployment: Invite Codes (جدول رموز الدعوة)
--  Run this in Supabase Dashboard → SQL Editor
--  https://supabase.com/dashboard/project/uzmhsesmszngkanjsjgy/sql/new
-- =====================================================================

create table if not exists public.invite_codes (
    code       text primary key,
    role       text not null check (role in ('data_entry', 'viewer')),
    is_used    boolean not null default false,
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now()
);

alter table public.invite_codes enable row level security;

create policy "authenticated can read invite_codes"
    on public.invite_codes for select
    to authenticated
    using (true);

create policy "authenticated can insert invite_codes"
    on public.invite_codes for insert
    to authenticated
    with check (true);

create policy "authenticated can update invite_codes"
    on public.invite_codes for update
    to authenticated
    using (true);

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

grant execute on function public.generate_invite_code(text)    to authenticated;
grant execute on function public.validate_invite_code(text)     to authenticated;
grant execute on function public.consume_invite_code(text)      to authenticated;
