# Leave Management System → Supabase + GitHub Pages (secure migration)

This document tracks the migration from the Express/SQLite backend to a
serverless Supabase architecture, deployed as a static site.

---

## ⚠️ FIRST: rotate the credentials you shared

A GitHub PAT and a Supabase `sbp_` token were pasted into a chat. Treat both
as compromised and **revoke + reissue** them before doing anything else:

- **GitHub PAT** → https://github.com/settings/tokens → delete it.
- **Supabase token** (`sbp_...`) → Dashboard → Account → Access Tokens → revoke it.
  - Note: `sbp_...` is a **management/personal access token**, *not* the anon key.
    It must never touch the frontend. The frontend needs the **anon JWT**
    (`eyJ...`) from **Settings → API**.

Also: a `backend/.env` already exists locally. It is now git-ignored, but if it
holds secrets, rotate those too.

---

## The security model (why this is safe on a public URL)

A static site on GitHub Pages ships its JavaScript — and any `VITE_*` value
baked into it — to everyone. So the design assumes the anon key **is** public:

1. **Row Level Security (RLS)** is on for every table. No anonymous access;
   a login is required to read anything.
2. **All sensitive writes go through `SECURITY DEFINER` RPCs** that re-check
   the caller's role and enforce every business rule **in Postgres**:
   - 40-day retroactive limit
   - insufficient-balance block
   - counter integrity (deducted totals can't desync)
   - admin-only employee edits / freezes / deletes / user management
3. The React checks are **UX only**. Even someone using the anon key by hand,
   with the full source code, cannot bypass the rules or write forbidden data.
4. Auth is **Supabase Auth** (passwords hashed/salted by Supabase). There is no
   `custom_users` table and no client-side password hashing.

---

## Milestone 1 — DONE (files written, ready for you to run)

| File | Purpose |
|------|---------|
| `supabase/schema.sql` | Tables, seed data, RLS policies, and all business-rule RPCs. **The security core.** |
| `frontend/src/supabaseClient.js` | Supabase client using the anon key from `VITE_*` env. |
| `frontend/.env.example` | Template for the two frontend env vars. |
| `.gitignore` | Now ignores every `.env` (was the leak vector). |

### Run it (≈5 minutes)

1. **Run the schema.** Supabase Dashboard → **SQL Editor** → paste all of
   `supabase/schema.sql` → **Run**. It creates everything and is safe to re-run.

2. **Create the frontend env file.**
   ```bash
   cd frontend
   cp .env.example .env
   # then edit .env: set VITE_SUPABASE_URL (base URL, no /rest/v1/)
   # and VITE_SUPABASE_ANON_KEY (the eyJ... anon key from Settings → API)
   ```

3. **Create the first admin** (replaces the old hardcoded `admin/admin2026`).
   Because admins are Supabase Auth users, create the admin once from the
   dashboard rather than hardcoding a password in code:
   - Dashboard → **Authentication → Users → Add user** → set email + a strong
     password → create.
   - Then promote it to admin in **SQL Editor**:
     ```sql
     update public.profiles set role = 'admin', username = 'admin'
     where id = (select id from auth.users where email = 'YOUR_ADMIN_EMAIL');
     ```
   > Do NOT commit that password anywhere. Pick it yourself; don't reuse the
   > `AdminPassword2026!` from the original brief.

---

## Milestone 2 — NEXT (frontend wiring + deploy) — not yet written

The refactor keeps your ~30 components intact by re-implementing the existing
`src/api/client.js` interface on top of Supabase. Planned changes:

- **`src/api/client.js`** → Supabase adapter. Same method names
  (`getEmployees`, `addDeduction`, …), new transport. Mapping:

  | Old API call | New Supabase call |
  |---|---|
  | `getEmployees()` | `select` employees/years (+ assemble) |
  | `addDeduction()` | `rpc('register_deduction', …)` |
  | `deleteDeduction()` | `rpc('delete_deduction', …)` |
  | `addEmployee()` / `updateEmployee()` | `rpc('create_employee' / 'update_employee', …)` |
  | `toggleFreeze()` | `rpc('toggle_employee_freeze', …)` |
  | `deleteEmployee()` | `delete` on employees (admin RLS) |
  | `getSettings()` / `updateSettings()` | `select` / `upsert` settings |
  | `getAuditLog()` | `select` audit_log (admin RLS) |
  | JSON import (sync bridge) | `rpc('sync_employees', …)` |

- **`src/context/AuthContext.jsx`** → Supabase Auth (`signInWithPassword`,
  `onAuthStateChange`), role read from `profiles`.
- **User Management (إدارة المستخدمين):** creating/deleting *login* accounts
  needs the service_role key, which cannot live in the browser. So it goes in a
  **Supabase Edge Function** (`manage-users`) that stores the service_role key
  as a server secret and only runs for callers whose JWT is an admin.
- **Custom confirm dialogs, glassmorphism login, JSON import button:** the app
  already has `CustomConfirmModal`, `ConfirmDangerModal`, and `Login.jsx` — these
  get reused/restyled rather than rebuilt.
- **Delete the Express `backend/` folder** once the adapter is verified.

### Deployment (GitHub Pages, no PAT in git config)

Use **GitHub Actions** rather than pushing from a local PAT:

- `vite.config.js` → set `base: '/YOUR_REPO_NAME/'`.
- `package.json` → `"homepage": "https://YOUR_USERNAME.github.io/YOUR_REPO_NAME"`.
- `.github/workflows/deploy.yml` builds on push to `main` and publishes to
  Pages, reading the anon key from repo **Secrets** (`VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`) — nothing secret is committed.
- You add the repo secrets and push; the deploy is automatic. I don't need, and
  won't use, your PAT.

**Still needed from you for Milestone 2:** your **GitHub username** and the
**repo name** you want (both were left as placeholders).
