-- =====================================================================
--  Migration: Close the client-supplied role escalation hole
--  ---------------------------------------------------------------------
--  Problem: RegistrationPortal.jsx calls supabase.auth.signUp({ options:
--  { data: { role, username } } }), and handle_new_user copied that role
--  straight into public.profiles:
--
--      coalesce(new.raw_user_meta_data->>'role', 'viewer')
--
--  raw_user_meta_data is attacker-controlled — it travels from the
--  browser with the public anon key, which is meant to be public. Anyone
--  calling supabase.auth.signUp() by hand with { data: { role: 'admin' } }
--  became an admin, no invite code required (consume_invite_code is only
--  called *after* signUp succeeds, and its failure is swallowed by the
--  frontend's `catch (_) {}`). This defeats every SECURITY DEFINER check
--  in the schema, since they all trust profiles.role.
--
--  Fix:
--   1. handle_new_user no longer reads raw_user_meta_data->>'role' at
--      all — every new sign-up is 'viewer', full stop.
--   2. consume_invite_code becomes the ONLY place a role above 'viewer'
--      is granted: it verifies the code server-side, then promotes the
--      CALLING user (auth.uid()) to that code's role. invite_codes.role
--      is constrained to ('data_entry','viewer') already, so this path
--      still can never mint an admin — admins are still only created by
--      an existing admin via update_user_role, unchanged.
-- =====================================================================

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
        'viewer', -- never trust a client-supplied role; see migration header
        new.email
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

create or replace function public.consume_invite_code(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_role text;
begin
    if auth.uid() is null then
        raise exception 'غير مصرح';
    end if;

    -- Lock the row so two concurrent redemptions of the same code can't
    -- both succeed.
    select role into v_role from public.invite_codes
        where code = p_code and is_used = false
        for update;
    if not found then
        raise exception 'رمز الدعوة غير صالح أو سبق استخدامه';
    end if;

    update public.invite_codes set is_used = true where code = p_code;

    -- The only role grant this function ever performs. v_role can only be
    -- 'data_entry' or 'viewer' — the invite_codes.role check constraint
    -- forbids storing 'admin' in this table.
    update public.profiles set role = v_role where id = auth.uid();

    return v_role;
end;
$$;

grant execute on function public.consume_invite_code(text) to authenticated;
