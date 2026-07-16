#!/usr/bin/env node
// server.mjs — Local proxy for admin operations
// Uses service_role key to call GoTrue Admin API + settings table
// Run: node server.mjs  (or double-click start.bat)

import http from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = parseInt(process.env.PORT || '3456', 10);
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uzmhsesmszngkanjsjgy.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6bWhzZXNtc3puZ2thbmpzamd5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzcwMjE0NywiZXhwIjoyMDk5Mjc4MTQ3fQ.6hD4DoCTZmhXPGn56lJmlOX2n_Yx0RozbQpaqwZWtyU';

const HEADERS = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
};

function json(res, status, data) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    });
    res.end(JSON.stringify(data));
}

// --- GoTrue Admin API helpers ---
async function goteListUsers() {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { headers: HEADERS });
    if (!r.ok) throw new Error(`GoTrue ${r.status}: ${await r.text()}`);
    const { users } = await r.json();
    return users;
}

async function goteCreateUser(email, password, role) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            user_metadata: { role, username: email.split('@')[0] },
        }),
    });
    if (!r.ok) {
        const body = await r.text();
        let msg = 'تعذر إنشاء المستخدم';
        if (body.includes('already exists') || body.includes('already registered')) msg = 'البريد الإلكتروني موجود مسبقاً';
        throw new Error(msg);
    }
    return r.json();
}

async function goteDeleteUser(id) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
        method: 'DELETE',
        headers: HEADERS,
    });
    if (!r.ok) throw new Error(`GoTrue ${r.status}: ${await r.text()}`);
}

// --- Invite codes via settings table ---
async function getSettings() {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/settings?select=key,value`, {
        headers: { ...HEADERS, 'Accept': 'application/json' },
    });
    if (!r.ok) throw new Error(`Settings ${r.status}`);
    return r.json();
}

async function upsertSetting(key, value) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/settings`, {
        method: 'POST',
        headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ key, value }),
    });
    if (!r.ok) {
        const body = await r.text();
        // retry as upsert with onConflict
        const r2 = await fetch(`${SUPABASE_URL}/rest/v1/settings`, {
            method: 'POST',
            headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify({ key, value }),
        });
        if (!r2.ok) throw new Error(`Upsert ${r2.status}: ${await r2.text()}`);
    }
}

async function deleteSetting(key) {
    await fetch(`${SUPABASE_URL}/rest/v1/settings?key=eq.${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: HEADERS,
    });
}

function inviteCodeKey(code) { return `invite_code:${code}`; }

function generateCode() {
    const random = randomBytes(10).toString('base64url');
    return `WQF-${random}`;
}

// --- HTTP Router ---
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;
    const method = req.method;

    // CORS preflight
    if (method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        });
        return res.end();
    }

    // Helper to read body
    function readBody() {
        return new Promise((resolve) => {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                try { resolve(JSON.parse(body || '{}')); }
                catch { resolve({}); }
            });
        });
    }

    try {
        // --- Health check ---
        if (method === 'GET' && path === '/ping') {
            return json(res, 200, { ok: true, server: 'hr-2026-awqf-proxy' });
        }

        // --- List users (GoTrue Admin) ---
        if (method === 'GET' && path === '/api/users') {
            const users = await goteListUsers();
            const mapped = users.map(u => ({
                id: u.id,
                email: u.email,
                username: u.user_metadata?.username || u.email?.split('@')[0] || '',
                role: u.user_metadata?.role || 'viewer',
                createdAt: u.created_at,
            }));
            // Also fetch profiles for usernames
            const pResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,username,created_at`, {
                headers: { ...HEADERS, 'Accept': 'application/json' },
            });
            if (pResp.ok) {
                const profiles = await pResp.json();
                const profileMap = {};
                profiles.forEach(p => { profileMap[p.id] = p; });
                mapped.forEach(u => {
                    const p = profileMap[u.id];
                    if (p) {
                        u.username = p.username || u.username;
                        u.createdAt = p.created_at || u.createdAt;
                    }
                });
            }
            return json(res, 200, { users: mapped });
        }

        // --- Create user (GoTrue Admin) ---
        if (method === 'POST' && path === '/api/users') {
            const { email, password, role } = await readBody();
            if (!email || !password) return json(res, 400, { error: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
            const user = await goteCreateUser(email, password, role || 'data_entry');
            return json(res, 201, { id: user.id, email: user.email, role: role || 'data_entry' });
        }

        // --- Delete user (GoTrue Admin) ---
        const deleteMatch = path.match(/^\/api\/users\/(.+)$/);
        if (method === 'DELETE' && deleteMatch) {
            await goteDeleteUser(deleteMatch[1]);
            return json(res, 200, { message: 'تم حذف المستخدم' });
        }

        // --- Invite: generate code ---
        if (method === 'POST' && path === '/api/invite-codes/generate') {
            const { role } = await readBody();
            const code = generateCode();
            const now = new Date().toISOString();
            await upsertSetting(inviteCodeKey(code), JSON.stringify({
                code, role: role || 'data_entry', is_used: false,
                created_by: 'admin', created_at: now,
            }));
            return json(res, 201, { code });
        }

        // --- Invite: list codes ---
        if (method === 'GET' && path === '/api/invite-codes') {
            const rows = await getSettings();
            const codes = rows
                .filter(r => r.key.startsWith('invite_code:'))
                .map(r => {
                    try { return JSON.parse(r.value); }
                    catch { return null; }
                })
                .filter(Boolean)
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            return json(res, 200, { codes });
        }

        // --- Invite: validate code ---
        if (method === 'GET' && path === '/api/invite-codes/validate') {
            const code = url.searchParams.get('code');
            if (!code) return json(res, 400, { valid: false, error: 'الكود مطلوب' });
            const rows = await getSettings();
            const row = rows.find(r => r.key === inviteCodeKey(code));
            if (!row) return json(res, 200, { valid: false, error: 'رمز الدعوة غير صحيح' });
            const data = JSON.parse(row.value);
            if (data.is_used) return json(res, 200, { valid: false, error: 'رمز الدعوة مستخدم مسبقاً' });
            return json(res, 200, { valid: true, role: data.role });
        }

        // --- Invite: consume code ---
        if (method === 'POST' && path === '/api/invite-codes/consume') {
            const { code, user_id } = await readBody();
            if (!code) return json(res, 400, { error: 'الكود مطلوب' });
            const rows = await getSettings();
            const row = rows.find(r => r.key === inviteCodeKey(code));
            if (!row) return json(res, 404, { error: 'رمز الدعوة غير موجود' });
            const data = JSON.parse(row.value);
            if (data.is_used) return json(res, 200, { message: 'رمز الدعوة مستخدم مسبقاً' });
            data.is_used = true;
            data.consumed_by = user_id || null;
            data.consumed_at = new Date().toISOString();
            await upsertSetting(inviteCodeKey(code), JSON.stringify(data));
            // Also update profile role
            if (user_id && data.role) {
                await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}`, {
                    method: 'PATCH',
                    headers: { ...HEADERS, 'Prefer': 'return=minimal' },
                    body: JSON.stringify({ role: data.role }),
                });
            }
            return json(res, 200, { message: 'تم استهلاك رمز الدعوة' });
        }

        // --- Settings proxy (for admin) ---
        if (method === 'GET' && path === '/api/settings') {
            const rows = await getSettings();
            const settings = {};
            rows.forEach(r => { if (!r.key.startsWith('invite_code:')) settings[r.key] = r.value; });
            return json(res, 200, { settings });
        }

        // --- Settings write proxy (for admin) ---
        if (method === 'POST' && path === '/api/settings') {
            const payload = await readBody();
            for (const [key, value] of Object.entries(payload)) {
                if (!key.startsWith('invite_code:')) {
                    await upsertSetting(key, value);
                }
            }
            return json(res, 200, { message: 'تم حفظ الإعدادات' });
        }

        // --- 404 ---
        return json(res, 404, { error: `Not found: ${method} ${path}` });

    } catch (err) {
        console.error(`[ERROR] ${method} ${path}:`, err.message);
        return json(res, 500, { error: err.message || 'خطأ داخلي في الخادم' });
    }
});

server.listen(PORT, () => {
    const addr = `http://localhost:${PORT}`;
    console.log(`\n  🚀  خادم الإدارة المحلية يعمل على:`);
    console.log(`  ${addr}`);
    console.log(`\n  افتح التطبيق في المتصفح واستخدم الإدارة كالمعتاد.`);
    console.log(`  اضغط Ctrl+C لإيقاف الخادم.\n`);
});
