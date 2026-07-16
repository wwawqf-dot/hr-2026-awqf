alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','data_entry','viewer'));

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
        jsonb_build_object('role', p_role),
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

create or replace function public.delete_auth_user(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not exists (select 1 from auth.users where id = p_id) then
        raise exception 'المستخدم غير موجود';
    end if;
    delete from auth.users where id = p_id;
end;
$$;

grant execute on function public.create_auth_user(text, text, text)   to authenticated;
grant execute on function public.delete_auth_user(uuid)               to authenticated;