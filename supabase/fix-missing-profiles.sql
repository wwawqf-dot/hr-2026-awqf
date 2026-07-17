-- =====================================================================
--  Fix: backfill missing profiles + ensure latest trigger function
--  ركّز هذا الملف في Supabase Dashboard → SQL Editor → Run
-- =====================================================================

-- 1. Update handle_new_user to include email
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

-- 2. Ensure trigger exists
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- 3. Backfill all missing profiles for existing auth users
--    (أهم خطوة — تعبي profiles لكل اليوزرز اللي اتعملوا قبل trigger)
insert into public.profiles (id, username, role, email)
select
    u.id,
    coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)),
    coalesce(u.raw_user_meta_data->>'role', 'viewer'),
    u.email
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- 4. Ensure email column is NOT NULL and unique
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

alter table public.profiles
    alter column email set not null,
    add constraint if not exists profiles_email_unique unique (email);

-- 5. Verify
select 'Profiles without auth user' as mismatch, count(*) from public.profiles p
where not exists (select 1 from auth.users u where u.id = p.id)
union all
select 'Auth users without profile', count(*) from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);
