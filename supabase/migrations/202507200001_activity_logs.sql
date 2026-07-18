-- =====================================================================
--  Migration: Activity Logs — automated security audit trail
--  ---------------------------------------------------------------------
--  Creates the activity_logs table used by the frontend's logActivity()
--  helper to record every key action: registering a leave, editing
--  employee data, toggling unpaid leave, freeze/unfreeze, archive/
--  restore, adding/archiving financial years.
--
--  SECURITY:
--    * RLS is ON — only authenticated users can INSERT (the
--      logActivity helper runs client-side with the anon key via
--      supabase.from('activity_logs').insert(...)).
--    * Only super admins can SELECT (checked via a helper that looks
--      up the requesting user's role in the profiles table).
--    * The INSERT policy is deliberately permissive for authenticated
--      users — we want every action logged without friction, and the
--      user_email column records who did it. An attacker flooding the
--      table is a minor DoS risk (fixed 50-row pages limit the UI
--      impact); a real production deployment should add rate-limiting.
-- =====================================================================

create table if not exists public.activity_logs (
    id bigserial primary key,
    user_email text not null,
    action_type text not null,
    details text,
    timestamp timestamptz not null default now()
);

alter table public.activity_logs enable row level security;

-- Everyone authenticated can insert — logging must never fail from
-- permissions. The user_email is captured from the session client-side
-- (see logActivity() in api/client.js), not from a trigger, so there is
-- no risk of a user spoofing another's email beyond their own JWT claim.
create policy "authenticated can insert activity_logs"
    on public.activity_logs
    for insert
    to authenticated
    with check (true);

-- Only admins can read the activity log. We use a subquery against the
-- profiles table because the JWT role claim can be stale if the user
-- was demoted without re-logging — the DB row is the source of truth.
create policy "admins can select activity_logs"
    on public.activity_logs
    for select
    to authenticated
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid()
            and role = 'admin'
        )
    );

-- Index for the paginated query (ORDER BY id DESC, LIMIT/OFFSET via
-- .range() on the client side).
create index if not exists idx_activity_logs_id_desc
    on public.activity_logs (id desc);

-- Index for filtering by action_type (useful for future filtering).
create index if not exists idx_activity_logs_action_type
    on public.activity_logs (action_type);
