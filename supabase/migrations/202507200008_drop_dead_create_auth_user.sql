-- =====================================================================
--  Migration: Drop the dead create_auth_user() RPC
--  ---------------------------------------------------------------------
--  User creation moved to the Supabase Dashboard link flow (UsersPage
--  opens Authentication → Users directly; the on_auth_user_created
--  trigger auto-provisions the profile with the default 'viewer' role),
--  so nothing in the frontend calls this function anymore.
--
--  It is not just dead code — it is a privilege-escalation hole: unlike
--  delete_auth_user()/update_user_role(), it never checked the caller's
--  role, yet EXECUTE was granted to `authenticated`. Any logged-in
--  session (even a read-only 'viewer') could call it directly over REST
--  and mint a fresh data_entry account with a password of its choosing,
--  bypassing the admin entirely.
-- =====================================================================

drop function if exists public.create_auth_user(text, text, text);
