-- =====================================================================
--  Migration: Drop three orphaned RPCs
--  ---------------------------------------------------------------------
--  Found during a full backend/frontend audit — none of these are called
--  from anywhere in the frontend:
--
--   * bulk_add_employees — its only caller was the Excel/CSV bulk-import
--     UI, removed from the frontend in an earlier cleanup commit
--     ("cleanup: remove dead code — ... unused serverBackup/
--     bulkAddEmployees ..."). The SQL function itself was never dropped.
--   * generate_invite_code — the frontend's generateInviteCode() writes
--     directly to public.invite_codes via the client (see api/client.js)
--     instead of calling this RPC. Never invoked.
--   * validate_invite_code — same story: the frontend's
--     validateInviteCode() reads public.invite_codes directly. Never
--     invoked.
-- =====================================================================

drop function if exists public.bulk_add_employees(jsonb, text);
drop function if exists public.generate_invite_code(text);
drop function if exists public.validate_invite_code(text);
