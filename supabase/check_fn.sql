select proname, prosrc from pg_proc where proname = 'handle_new_user' and pronamespace = (select oid from pg_namespace where nspname = 'public');
