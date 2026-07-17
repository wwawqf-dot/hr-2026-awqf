-- Step 1: Diagnostics
-- 1. Trigger exists?
select '1. Trigger on_auth_user_created' as check_name,
  case when count(*) > 0 then 'EXISTS' else 'MISSING' end as status
from information_schema.triggers
where event_object_table = 'users'
  and event_object_schema = 'auth'
  and trigger_name = 'on_auth_user_created';

-- 2. Auth users count
select '2. Auth users count' as check_name, count(*)::text as status from auth.users;

-- 3. Profiles count
select '3. Profiles count' as check_name, count(*)::text as status from public.profiles;

-- 4. Auth users WITHOUT profile
select '4. Auth users without profile' as check_name, count(*)::text as status
from auth.users u left join public.profiles p on p.id = u.id
where p.id is null;

-- 5. Admin has profile?
select '5. Admin (abdo.shta@gmail.com) has profile?' as check_name,
  coalesce(p.role, 'NO PROFILE') as status
from auth.users u left join public.profiles p on p.id = u.id
where u.email = 'abdo.shta@gmail.com';

-- 6. Profiles with NULL email
select '6. Profiles with NULL email' as check_name, count(*)::text as status
from public.profiles where email is null;

-- 7. Email column nullable?
select '7. Email column nullable?' as check_name, is_nullable as status
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'email';

---------------------------------------------------------------------
-- Step 2: Fix

-- Add email column if missing
alter table public.profiles add column if not exists email text;

-- Update handle_new_user function (includes email)
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

-- Re-create trigger on auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Backfill missing profiles
insert into public.profiles (id, username, role, email)
select
    u.id,
    coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)),
    coalesce(u.raw_user_meta_data->>'role', 'viewer'),
    u.email
from auth.users u left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- Fill NULL emails in existing profiles
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- Now safe to add NOT NULL + UNIQUE
alter table public.profiles
    alter column email set not null,
    add constraint if not exists profiles_email_unique unique (email);

---------------------------------------------------------------------
-- Step 3: Verify

select '=== AFTER FIX ===' as "";

-- 8. Auth users count
select '8. Auth users count (after fix)' as check_name, count(*)::text as status from auth.users;

-- 9. Profiles count
select '9. Profiles count (after fix)' as check_name, count(*)::text as status from public.profiles;

-- 10. Remaining missing profiles
select '10. Auth users still without profile' as check_name, count(*)::text as status
from auth.users u left join public.profiles p on p.id = u.id
where p.id is null;

-- 11. All profiles
select '11. All profiles' as check_name,
  string_agg(id::text || ':' || username || ':' || role || ':' || email, ', ') as status
from public.profiles
order by created_at;
