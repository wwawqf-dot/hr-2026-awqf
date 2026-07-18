import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Scoped allowlist instead of a wildcard: this function creates/deletes
// user accounts, so it shouldn't hand out CORS access to arbitrary
// origins. Includes local dev (Vite's default port) alongside the
// deployed GitHub Pages origin.
const ALLOWED_ORIGINS = [
    'https://wwawqf-dot.github.io',
    'http://localhost:5173',
];

function corsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get('origin') ?? '';
    return {
        'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        Vary: 'Origin',
    };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
    });
}

Deno.serve(async (req) => {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

    try {
        const url = Deno.env.get('SUPABASE_URL')!;
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        const authHeader = req.headers.get('Authorization') ?? '';
        if (!authHeader) return json({ error: 'غير مصرح' }, 401, cors);

        // 1) Identify the caller from their JWT and confirm they're an admin.
        const caller = createClient(url, anonKey, {
            global: { headers: { Authorization: authHeader } },
        });
        const { data: { user }, error: userErr } = await caller.auth.getUser();
        if (userErr || !user) return json({ error: 'الجلسة غير صالحة' }, 401, cors);

        const admin = createClient(url, serviceKey);
        const { data: profile } = await admin
            .from('profiles').select('role').eq('id', user.id).single();
        if (profile?.role !== 'admin') {
            return json({ error: 'هذه العملية مقصورة على المدير' }, 403, cors);
        }

        const body = await req.json().catch(() => ({}));
        const action = body?.action;

        if (action === 'create') {
            const email = String(body.email ?? '').trim();
            const password = String(body.password ?? '');
            const role = String(body.role ?? 'data_entry').trim();
            if (!email || password.length < 6) {
                return json({ error: 'بريد إلكتروني أو كلمة مرور غير صالحة (6 أحرف على الأقل)' }, 400, cors);
            }
            if (!['data_entry', 'viewer'].includes(role)) {
                return json({ error: 'الصلاحية غير صالحة. يجب أن تكون data_entry أو viewer.' }, 400, cors);
            }
            const { data, error } = await admin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: { role, username: email },
            });
            if (error) return json({ error: error.message }, 400, cors);
            return json({
                user: {
                    id: data.user.id,
                    username: email,
                    role,
                    createdAt: data.user.created_at,
                },
            }, 200, cors);
        }

        if (action === 'delete') {
            const id = String(body.id ?? '');
            if (!id) return json({ error: 'معرّف مستخدم غير صالح' }, 400, cors);
            const { data: target } = await admin
                .from('profiles').select('role').eq('id', id).single();
            if (!target) return json({ error: 'المستخدم غير موجود' }, 404, cors);
            if (target.role !== 'data_entry' && target.role !== 'viewer') {
                return json({ error: 'لا يمكن حذف حسابات المدير' }, 400, cors);
            }
            const { error } = await admin.auth.admin.deleteUser(id);
            if (error) return json({ error: error.message }, 400, cors);
            return json({ message: 'تم حذف المستخدم' }, 200, cors);
        }

        return json({ error: 'إجراء غير معروف' }, 400, cors);
    } catch (e) {
        return json({ error: (e as Error)?.message ?? 'خطأ في الخادم' }, 500, cors);
    }
});
