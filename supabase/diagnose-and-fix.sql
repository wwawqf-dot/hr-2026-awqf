-- =====================================================================
--  تشخيص وإصلاح مشكلة عدم ظهور المستخدمين
--  ركّز هذا الملف كاملاً في Supabase Dashboard → SQL Editor → Run
-- =====================================================================

-- ============================================================
--  الجزء الأول: التشخيص
-- ============================================================

select '=== التشخيص ===' as "";

-- 1. هل trigger موجود على auth.users؟
select
    '1. Trigger on_auth_user_created' as check_name,
    case when count(*) > 0 then 'موجود' else 'غير موجود' end as status
from information_schema.triggers
where event_object_table = 'users'
  and event_object_schema = 'auth'
  and trigger_name = 'on_auth_user_created';

-- 2. صيغة handle_new_user الحالية
select '2. handle_new_user function body:' as check_name;
select prosrc from pg_proc where proname = 'handle_new_user' and pronamespace = 'public'::regnamespace;

-- 3. عدد المستخدمين في auth.users
select
    '3. Auth users count' as check_name,
    count(*)::text as status
from auth.users;

-- 4. عدد profiles الموجودة
select
    '4. Profiles count' as check_name,
    count(*)::text as status
from public.profiles;

-- 5. المستخدمين الناقصين (في auth.users وليس في profiles)
select
    '5. Auth users WITHOUT profile' as check_name,
    count(*)::text as status
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- 6. هل admin الحالي عنده profile؟
select
    '6. Admin user has profile?' as check_name,
    case when p.id is not null then 'نعم، role = ' || p.role else 'لا يوجد profile' end as status
from auth.users u
left join public.profiles p on p.id = u.id
where u.email = 'abdo.shta@gmail.com';

-- 7. هل profile نفسه عنده email NOT NULL؟
select
    '7. Profiles with NULL email' as check_name,
    count(*)::text as status
from public.profiles
where email is null;

-- 8. صيغة عمود email في profiles
select
    '8. Email column nullable?' as check_name,
    is_nullable as status
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name = 'email';

-- ============================================================
--  الجزء الثاني: الإصلاح الكامل
-- ============================================================

select '=== بدء الإصلاح ===' as "";

-- 1. تأكد من وجود عمود email
alter table public.profiles
    add column if not exists email text;

-- 2. حدّث دالة handle_new_user بأحدث صيغة (تشمل email)
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

-- 3. تأكد من وجود trigger على auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- 4. صلّح جميع profiles الناقصة (أهم خطوة)
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

-- 5. تعبئة email الفارغة في profiles الموجودة
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- 6. الآن أضف NOT NULL UNIQUE بأمان
alter table public.profiles
    alter column email set not null,
    add constraint if not exists profiles_email_unique unique (email);

-- ============================================================
--  الجزء الثالث: التحقق بعد الإصلاح
-- ============================================================

select '=== التحقق بعد الإصلاح ===' as "";

select
    'المستخدمين في profiles' as "",
    count(*)::text as العدد
from public.profiles;

select
    'المستخدمين الناقصين',
    count(*)::text
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

select
    'مستخدمي profiles',
    id,
    username,
    role,
    email,
    created_at
from public.profiles
order by created_at;
