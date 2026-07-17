select 'trigger' as info, case when count(*)>0 then 'exists' else 'missing' end as value from information_schema.triggers where event_object_table='users' and event_object_schema='auth' and trigger_name='on_auth_user_created'
union all select 'auth_users' as info, count(*)::text as value from auth.users
union all select 'profiles' as info, count(*)::text as value from public.profiles
union all select 'missing_profiles' as info, count(*)::text as value from auth.users u left join public.profiles p on p.id=u.id where p.id is null
union all select 'has_email_col' as info, case when count(*)>0 then 'yes' else 'no' end as value from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='email'
union all select 'fn_has_email' as info, case when prosrc like '%email%' then 'yes' else 'no' end as value from pg_proc where proname='handle_new_user' and pronamespace='public'::regnamespace;
