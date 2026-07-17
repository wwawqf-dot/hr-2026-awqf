select column_name, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='employees' and column_name in ('include_in_print','is_unpaid_leave');
