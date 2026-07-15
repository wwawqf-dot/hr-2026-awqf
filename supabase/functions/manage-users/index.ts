// Supabase Edge Function: manage-users
// ---------------------------------------------------------------------
// Creates / deletes *login* accounts for the User Management panel.
// This needs the service_role key (admin API), which must NEVER be shipped
// to the browser — so it lives here, server-side. The function:
//   1. verifies the CALLER is an authenticated admin (from their JWT),
//   2. only then uses the service_role client to create/delete the user.
//
// Deploy:  supabase functions deploy manage-users
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are
//  injected automatically by the Supabase platform.)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
    });
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

    try {
        const url = Deno.env.get('SUPABASE_URL')!;
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        const authHeader = req.headers.get('Authorization') ?? '';
        if (!authHeader) return json({ error: 'غير مصرح' }, 401);

        // 1) Identify the caller from their JWT and confirm they're an admin.
        const caller = createClient(url, anonKey, {
            global: { headers: { Authorization: authHeader } },
        });
        const { data: { user }, error: userErr } = await caller.auth.getUser();
        if (userErr || !user) return json({ error: 'الجلسة غير صالحة' }, 401);

        const admin = createClient(url, serviceKey);
        const { data: profile } = await admin
            .from('profiles').select('role').eq('id', user.id).single();
        if (profile?.role !== 'admin') {
            return json({ error: 'هذه العملية مقصورة على المدير' }, 403);
        }

        const body = await req.json().catch(() => ({}));
        const action = body?.action;

        // 2) Perform the privileged operation.
        if (action === 'create') {
            const email = String(body.email ?? '').trim();
            const password = String(body.password ?? '');
            if (!email || password.length < 6) {
                return json({ error: 'بريد إلكتروني أو كلمة مرور غير صالحة (6 أحرف على الأقل)' }, 400);
            }
            const { data, error } = await admin.auth.admin.createUser({
                email,
                password,
                email_confirm: true, // internal system: usable immediately, no email step
                user_metadata: { role: 'data_entry', username: email },
            });
            if (error) return json({ error: error.message }, 400);
            return json({
                user: {
                    id: data.user.id,
                    username: email,
                    role: 'data_entry',
                    createdAt: data.user.created_at,
                },
            });
        }

        if (action === 'delete') {
            const id = String(body.id ?? '');
            if (!id) return json({ error: 'معرّف مستخدم غير صالح' }, 400);
            const { data: target } = await admin
                .from('profiles').select('role').eq('id', id).single();
            if (!target) return json({ error: 'المستخدم غير موجود' }, 404);
            if (target.role !== 'data_entry') {
                return json({ error: 'لا يمكن حذف حسابات المدير، فقط مستخدمي إدخال البيانات' }, 400);
            }
            const { error } = await admin.auth.admin.deleteUser(id);
            if (error) return json({ error: error.message }, 400);
            return json({ message: 'تم حذف المستخدم' });
        }

        return json({ error: 'إجراء غير معروف' }, 400);
    } catch (e) {
        return json({ error: (e as Error)?.message ?? 'خطأ في الخادم' }, 500);
    }
});
