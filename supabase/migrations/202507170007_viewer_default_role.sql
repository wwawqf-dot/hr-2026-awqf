-- =====================================================================
--  Migration: Set default role to 'viewer' for users created via
--  Supabase Dashboard, and ensure the trigger on auth.users exists.
-- =====================================================================

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
