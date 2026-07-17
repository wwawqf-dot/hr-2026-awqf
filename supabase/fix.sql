-- Fix: update trigger function, ensure trigger exists, backfill profiles
alter table public.profiles add column if not exists email text;

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

insert into public.profiles (id, username, role, email)
select
    u.id,
    coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)),
    coalesce(u.raw_user_meta_data->>'role', 'viewer'),
    u.email
from auth.users u left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

alter table public.profiles
    alter column email set not null;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'profiles_email_unique'
        and connamespace = 'public'::regnamespace
    ) then
        alter table public.profiles
            add constraint profiles_email_unique unique (email);
    end if;
end $$;
