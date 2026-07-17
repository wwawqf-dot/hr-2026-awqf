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
        coalesce(new.raw_user_meta_data->>'role', 'data_entry')
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

-- ============================================================
--  4. إعدادات Auth — تعطيل تأكيد البريد الإلكتروني
-- ============================================================
--  ارجع إلى Dashboard ← Authentication ← Settings
--  واجعل "Confirm email" = OFF (مطفأ)
--  الرابط المباشر:
--  https://supabase.com/dashboard/project/uzmhsesmszngkanjsjgy/auth/settings
-- ============================================================

-- ============================================================
--  تم الانتهاء من النشر
--  تحقق من absence of errors في الأسفل
-- ============================================================
