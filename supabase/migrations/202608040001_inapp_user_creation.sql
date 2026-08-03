-- =====================================================================
--  In-app user creation (admin only) + login by username
--  ---------------------------------------------------------------------
--  Admins create accounts with NAME + PASSWORD only. Supabase Auth still
--  needs an email internally, so one is generated automatically
--  (wqf-<random>@internal.local) and never shown. Login resolves the
--  typed username back to that internal email.
--
--  Security: SECURITY DEFINER + explicit current_app_role() = 'admin'
--  check → same guarantee as before (only an existing admin can create
--  accounts / grant data_entry or viewer). handle_new_user still fires
--  and provisions the profile row.
-- =====================================================================

-- The deployed check constraint only allowed admin/data_entry. The app
-- also uses 'viewer' (default role from handle_new_user and the only
-- role registration/invite flows mint), so include it.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','data_entry','viewer'));

-- Resolve a login identifier to the auth email.

-- Resolve a login identifier to the auth email.
--   * input containing '@'  -> returned unchanged (real/legacy emails)
--   * any other input       -> looked up in profiles by username
-- Security: anon+authenticated may call this; it reveals nothing more
-- than a username ↦ internal-email mapping.
create or replace function public.resolve_login(p_identifier text)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select case
        when position('@' in coalesce(p_identifier,'')) > 0 then p_identifier
        else (
            select email from public.profiles
            where username = trim(coalesce(p_identifier,''))
            limit 1
        )
    end;
$$;

grant execute on function public.resolve_login(text) to anon, authenticated;

-- Create a Supabase Auth user from NAME + PASSWORD (+ optional role).
-- Returns email + username so the UI can confirm what was created.
create or replace function public.create_user(
    p_email    text,      -- generated email, kept out of the UI
    p_password text,
    p_username text,
    p_role     text default 'viewer'
)
returns json
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp, extensions
as $$
declare
    v_user_id uuid;
    v_enc_pw  text;
    v_email   text;
    v_username text;
begin
    if public.current_app_role() != 'admin' then
        raise exception 'هذه العملية مقصورة على المدير';
    end if;
    if p_role not in ('data_entry', 'viewer') then
        raise exception 'الصلاحية غير صالحة';
    end if;
    v_username := trim(coalesce(p_username, ''));
    if v_username = '' then
        raise exception 'يرجى إدخال اسم المستخدم';
    end if;
    if char_length(coalesce(p_password,'')) < 6 then
        raise exception 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
    end if;
    if exists (select 1 from public.profiles where username = v_username) then
        raise exception 'هذا الاسم مسجل مسبقاً للمستخدمين';
    end if;

    -- Generate an internal-only email. The username columns of profiles
    -- are what the app actually shows; the email is never surfaced.
    v_email := 'wqf-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) || '@internal.local';
    v_user_id := gen_random_uuid();
    v_enc_pw  := extensions.crypt(p_password, extensions.gen_salt('bf'));

    -- The on_auth_user_created trigger (handle_new_user) fires on this
    -- insert and creates the profiles row with username + 'viewer';
    -- we then set the requested role below.
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, invited_at,
        confirmation_token, recovery_token, email_change_token_new,
        email_change, raw_app_meta_data, raw_user_meta_data,
        is_super_admin, is_sso_user, is_anonymous, created_at, updated_at
    ) values (
        '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
        v_email, v_enc_pw, now(), now(),
        '', '', '',
        '', jsonb_build_object('provider', 'email', 'providers', array['email']),
        jsonb_build_object('role', p_role, 'username', v_username),
        false, false, false, now(), now()
    );

    insert into auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
    ) values (
        v_user_id, v_user_id,
        jsonb_build_object('sub', v_user_id, 'email', v_email),
        'email', v_email,
        now(), now(), now()
    );

    update public.profiles set role = p_role where id = v_user_id;

    return json_build_object('id', v_user_id::text, 'email', v_email, 'username', v_username);
end;
$$;

grant execute on function public.create_user(text, text, text, text) to authenticated;