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

## Milestone 2 — DONE (frontend wired + deploy configured)

All code is written, it builds cleanly (`npm run build` ✓), and a local git
commit exists on `main`. What changed:

| File | Change |
|------|--------|
| `frontend/src/api/client.js` | Rewritten as a Supabase adapter — same method names, new transport (RPCs + selects). |
| `frontend/src/context/AuthContext.jsx` | Supabase Auth (`signInWithPassword`, `onAuthStateChange`); role from `profiles`. |
| `frontend/src/components/Login.jsx` | Logs in by **email** now. |
| `frontend/src/components/UsersPage.jsx` | Email-based accounts; shows credentials once at creation (Supabase can't reveal stored passwords). |
| `supabase/functions/manage-users/index.ts` | Edge Function for admin create/delete of login accounts (service_role stays server-side). |
| `frontend/vite.config.js` | `base` from `VITE_BASE` (Actions sets it to `/<repo>/`). |
| `frontend/package.json` | Adds `@supabase/supabase-js`, `gh-pages`, `homepage`, deploy scripts. |
| `.github/workflows/deploy.yml` | Builds + publishes to Pages on push to `main`. |

Adapter mapping: `getEmployees→list_employees`, `addDeduction→register_deduction`,
`deleteDeduction→delete_deduction`, `add/updateEmployee→create/update_employee`,
`toggleFreeze→toggle_employee_freeze`, `add/deleteYear→add_year/delete_year`,
`bulkAddEmployees→bulk_add_employees`, `exportBackup→export_all`,
JSON import→`sync_employees`, users→`manage-users` Edge Function.

> Note: the old Express `backend/` folder is now unused. It's kept for
> reference (and is git-ignored for its data). Delete it whenever you're
> confident the cloud version is working.

---

## DEPLOY RUNBOOK — the steps you run

I don't run these: pushing/publishing needs **your** GitHub token, and this is a
non-interactive environment. Each step is yours (or one you approve).

### A. Deploy the Edge Function (for User Management)
Requires the Supabase CLI (`npm i -g supabase`), then:
```bash
cd hr-2026-awqf
supabase login
supabase link --project-ref uzmhsesmszngkanjsjgy
supabase functions deploy manage-users
```

### B. Create the GitHub repo and push
1. Create a **new empty repo** on GitHub (no README) named e.g. `leave-system`.
2. From the project folder:
   ```bash
   cd hr-2026-awqf
   git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO>.git
   git push -u origin main
   ```
   When prompted for a password, paste your **freshly-created** GitHub PAT
   (username = your GitHub username). Git will store it; you don't send it to me.

### C. Add the build secrets + enable Pages
In the new repo on GitHub:
1. **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `VITE_SUPABASE_URL` = `https://uzmhsesmszngkanjsjgy.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = your `eyJ...` anon key
2. **Settings → Pages → Build and deployment → Source = GitHub Actions**.
3. Push (or re-run the workflow from the **Actions** tab). When it goes green:

```
https://<YOUR_USERNAME>.github.io/<YOUR_REPO>/
```

### D. First login
Use the admin email/password you created in Supabase (Milestone 1, step 3).

---

### Alternative to B–C: manual `gh-pages` (if you prefer)
```powershell
cd hr-2026-awqf/frontend
$env:VITE_SUPABASE_URL="https://uzmhsesmszngkanjsjgy.supabase.co"
$env:VITE_SUPABASE_ANON_KEY="eyJ...your-anon..."
$env:VITE_BASE="/<YOUR_REPO>/"
npm run build
npm run deploy   # pushes dist/ to the gh-pages branch (asks for your PAT)
```
Then set **Settings → Pages → Source = Deploy from branch → `gh-pages`**.
