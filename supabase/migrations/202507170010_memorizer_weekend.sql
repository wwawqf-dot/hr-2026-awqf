-- =====================================================================
--  Migration: Memorizer weekend exclusion rule
--  1. Add is_memorizer column to employees table
--  2. Update calculate_deduction_days: use is_memorizer instead of job_title
--     Regular (is_memorizer=false): skip Thu(4)+Fri(5)
--     Memorizer (is_memorizer=true): skip Fri(5)+Sat(6)
-- =====================================================================

alter table public.employees
    add column if not exists is_memorizer boolean not null default false;

create or replace function public.calculate_deduction_days(
    p_start text, p_end text, p_custom_holidays numeric default 0, p_is_memorizer boolean default false
) returns numeric
language plpgsql
immutable
as $$
declare
    d_start date; d_end date; cur date; cnt int := 0; wd int; weekend int[];
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

    if p_is_memorizer then weekend := array[5,6];
    else weekend := array[4,5]; end if;

    cur := d_start;
    while cur <= d_end loop
        wd := extract(dow from cur)::int;
        if not (wd = any(weekend)) then cnt := cnt + 1; end if;
        cur := cur + 1;
    end loop;

    return greatest(0, cnt - coalesce(p_custom_holidays, 0));
end;
$$;

grant execute on function public.calculate_deduction_days(text, text, numeric, boolean) to authenticated;
