-- Fix duplicate calculate_deduction_days function signature
-- The function was created twice (once by schema.sql / deploy-all.sql and
-- once by migration 202507180001) with the same (text, text, numeric)
-- signature, causing "function is not unique" errors at call sites.
drop function if exists public.calculate_deduction_days(text, text, numeric, boolean);
drop function if exists public.calculate_deduction_days(text, text, numeric);

create or replace function public.calculate_deduction_days(
    p_start text, p_end text, p_custom_holidays numeric default 0
) returns numeric
language plpgsql
immutable
as $$
declare
    d_start date; d_end date; cur date; cnt int := 0; wd int;
begin
    if p_start is null or p_end is null or p_start = '' or p_end = '' then
        return 0;
    end if;
    begin
        d_start := p_start::date;
        d_end   := p_end::date;
    exception when others then
        return 0;
    end;
    if d_end < d_start then return 0; end if;

    cur := d_start;
    while cur <= d_end loop
        wd := extract(dow from cur)::int;
        if wd != 5 and wd != 6 then cnt := cnt + 1; end if;
        cur := cur + 1;
    end loop;

    return greatest(0, cnt - coalesce(p_custom_holidays, 0));
end;
$$;

grant execute on function public.calculate_deduction_days(text, text, numeric) to authenticated;
