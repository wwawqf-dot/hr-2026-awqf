-- =====================================================================
--  Migration: Super Admin protection layer
--  1. Add email column to profiles for super admin identification
--  2. Create update_user_role RPC with super admin block
--  3. Strengthen delete_auth_user with super admin block
-- =====================================================================

-- Super admin email constant (change this to match the actual root admin)
-- This is the one user who can NEVER be demoted, deleted, or edited.
-- For production, change this to the actual super admin email.
create schema if not exists app_constants;
create or replace function app_constants.super_admin_email()
returns text
language sql
immutable
as $$
    select 'abdo.shta@gmail.com'::text;
$$;

-- ----------------------------------------------------------
-- 1. Add email column to profiles
-- ----------------------------------------------------------
alter table public.profiles
    add column if not exists email text default null;

-- Backfill existing profiles with email from auth.users where missing
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- Make email unique + not null after backfill (new rows handled by trigger)
alter table public.profiles
    alter column email set not null,
    add constraint profiles_email_unique unique (email);

-- ----------------------------------------------------------
-- 2. Update handle_new_user to store email
-- ----------------------------------------------------------
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

-- ----------------------------------------------------------
-- 3. update_user_role RPC — protects super admin
-- ----------------------------------------------------------
create or replace function public.update_user_role(p_user_id uuid, p_new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_target_email text;
    v_super_email  text := app_constants.super_admin_email();
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
    if v_target_email = v_super_email then
        raise exception 'لا يمكن تعديل صلاحية المدير الأساسي للنظام';
    end if;
    update public.profiles set role = p_new_role where id = p_user_id;
end;
$$;

grant execute on function public.update_user_role(uuid, text) to authenticated;

-- ----------------------------------------------------------
-- 4. Strengthen delete_auth_user with super admin block
-- ----------------------------------------------------------
create or replace function public.delete_auth_user(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_target_email text;
    v_super_email  text := app_constants.super_admin_email();
begin
    if public.current_app_role() != 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    select email into v_target_email from public.profiles where id = p_id;
    if not found then
        raise exception 'المستخدم غير موجود';
    end if;
    if v_target_email = v_super_email then
        raise exception 'لا يمكن حذف المدير الأساسي للنظام';
    end if;
    delete from auth.users where id = p_id;
end;
$$;

grant execute on function public.delete_auth_user(uuid) to authenticated;
