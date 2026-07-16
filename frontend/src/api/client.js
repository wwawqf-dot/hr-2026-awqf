import { createClient } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';

const PROXY_PORT = 3456;
const PROXY_BASE = `http://localhost:${PROXY_PORT}`;

class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

let onAuthExpired = null;
export function setOnAuthExpired(fn) { onAuthExpired = fn; }

let _proxyAvailable = null;

export async function checkProxy() {
    if (_proxyAvailable !== null) return _proxyAvailable;
    try {
        const r = await fetch(`${PROXY_BASE}/ping`, { signal: AbortSignal.timeout(2000) });
        _proxyAvailable = r.ok;
    } catch {
        _proxyAvailable = false;
    }
    return _proxyAvailable;
}

export function resetProxyCache() { _proxyAvailable = null; }

function isNetworkError(error) {
    if (!error) return false;
    const msg = (error.message || '').toLowerCase();
    return /fetch failed|networkerror|network error|failed to fetch|request terminated|abort/i.test(msg)
        || error.name === 'TypeError' && (msg.includes('fetch') || msg.includes('network'));
}

function isAuthExpired(error) {
    if (!error) return false;
    const status = error.status ?? error.code ?? 0;
    const msg = (error.message || '').toLowerCase();
    return status === 401 || msg.includes('jwt') || msg.includes('not authenticated') || msg.includes('auth');
}

function isServerError(error) {
    if (!error) return false;
    const status = error.status ?? error.code ?? 0;
    return status >= 500;
}

const NETWORK_MSG = 'فشل الاتصال بالخادم، يرجى التحقق من الإنترنت وإعادة المحاولة.';
const SESSION_MSG = 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى.';
const SERVER_MSG  = 'الخادم غير متاح حالياً، يرجى المحاولة لاحقاً.';
const PROXY_MSG   = 'خادم الإدارة المحلية غير متاح. يرجى تشغيل start.bat';

function classifyError(error) {
    if (isNetworkError(error)) return { status: 0, message: NETWORK_MSG };
    if (isAuthExpired(error))  return { status: 401, message: SESSION_MSG };
    if (isServerError(error))  return { status: 503, message: SERVER_MSG };
    return null;
}

async function safeSupabase(promise, fallback = 'حدث خطأ غير متوقع') {
    try {
        const { data, error } = await promise;
        if (error) {
            const classified = classifyError(error);
            if (classified) {
                if (classified.status === 401 && onAuthExpired) onAuthExpired();
                throw new ApiError(classified.message, classified.status);
            }
            throw new ApiError(error.message || fallback, error.status || 400);
        }
        return data;
    } catch (e) {
        if (e instanceof ApiError) throw e;
        const classified = classifyError(e);
        if (classified) {
            if (classified.status === 401 && onAuthExpired) onAuthExpired();
            throw new ApiError(classified.message, classified.status);
        }
        if (isServerError(e)) throw new ApiError(SERVER_MSG, 503);
        if (isNetworkError(e)) throw new ApiError(NETWORK_MSG, 0);
        throw new ApiError(fallback, 400);
    }
}

function rpc(fn, args) {
    return safeSupabase(supabase.rpc(fn, args));
}

async function rpcAdmin(fn, args) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
        throw new ApiError('لا توجد جلسة نشطة لتأكيد العملية', 401);
    }
    const ephemeral = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY,
        {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${session.access_token}` } },
        }
    );
    return safeSupabase(ephemeral.rpc(fn, args));
}

async function proxyFetch(path, options = {}) {
    const available = await checkProxy();
    if (!available) throw new ApiError(PROXY_MSG, 503);
    try {
        const r = await fetch(`${PROXY_BASE}${path}`, {
            signal: AbortSignal.timeout(10000),
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        if (r.status === 204) return null;
        const data = await r.json();
        if (!r.ok) throw new ApiError(data.error || 'خطأ في الخادم المحلي', r.status);
        return data;
    } catch (e) {
        if (e instanceof ApiError) throw e;
        _proxyAvailable = false;
        throw new ApiError(PROXY_MSG, 503);
    }
}

async function listYears() {
    const data = await safeSupabase(supabase.from('years').select('year'));
    return { years: (data || []).map((r) => r.year).sort((a, b) => Number(a) - Number(b)) };
}

async function listExpiringLeaves(windowDays = 7) {
    const { getLibyaTime } = await import('../utils/libyaTime');
    const today = getLibyaTime();
    const ceiling = getLibyaTime();
    ceiling.setDate(ceiling.getDate() + windowDays);
    const fmt = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const data = await safeSupabase(
        supabase
            .from('deductions')
            .select('id, end_date, start_date, days, employee:employees(name, job_number)')
            .gte('end_date', fmt(today))
            .lte('end_date', fmt(ceiling))
            .order('end_date')
    );

    return {
        expiring: (data || []).map((d) => ({
            name: d.employee?.name || '',
            job_number: d.employee?.job_number || '',
            end_date: d.end_date,
            start_date: d.start_date,
            days: d.days,
        })),
    };
}

export const api = {
    // ---- Proxy metadata ------------------------------------------------
    checkProxy,

    // ---- Employees & roster ------------------------------------------
    getEmployees: () => rpc('list_employees'),
    addEmployee: (payload) => rpc('create_employee', { p_payload: payload }),
    updateEmployee: (id, payload) => rpc('update_employee', { p_id: id, p_payload: payload }),
    deleteEmployee: async (id) => {
        await safeSupabase(supabase.from('employees').delete().eq('id', id));
        return { message: 'تم حذف الموظف' };
    },
    toggleFreeze: (id) => rpc('toggle_employee_freeze', { p_id: id }),
    bulkAddEmployees: (rows, reconciliationNote = 'تسوية جرد ورقي') =>
        rpc('bulk_add_employees', { p_rows: rows, p_note: reconciliationNote }),

    // ---- Financial years ---------------------------------------------
    getYears: () => listYears(),
    addYear: (payload) => {
        const year = String(payload?.year ?? payload ?? '').trim();
        const defaultAddedDays = payload?.defaultAddedDays;
        return rpc('add_year', {
            p_year: year,
            p_default_days: defaultAddedDays === undefined || defaultAddedDays === null || defaultAddedDays === ''
                ? 30 : Number(defaultAddedDays),
        });
    },
    deleteYear: (year) => rpc('delete_year', { p_year: String(year) }),

    // ---- Deductions ---------------------------------------------------
    getExpiringLeaves: () => listExpiringLeaves(),
    addDeduction: (employeeId, payload) =>
        rpc('register_deduction', { p_employee_id: employeeId, p_payload: payload }),
    deleteDeduction: (deductionId) => rpc('delete_deduction', { p_deduction_id: deductionId }),

    // ---- Settings -----------------------------------------------------
    getSettings: async () => {
        const rows = await safeSupabase(supabase.from('settings').select('key, value'));
        const settings = {};
        (rows || []).forEach((r) => { settings[r.key] = r.value; });
        return { settings };
    },
    updateSettings: async (payload) => {
        const dateRe = /^\d{4}-\d{2}-\d{2}$/;
        const upserts = [];
        if (payload.openingBalanceDate !== undefined) {
            if (!dateRe.test(payload.openingBalanceDate))
                throw new ApiError('يرجى إدخال تاريخ قطع صحيح بصيغة YYYY-MM-DD', 400);
            upserts.push({ key: 'openingBalanceDate', value: payload.openingBalanceDate });
        }
        if (payload.system_reference_date !== undefined) {
            if (!dateRe.test(payload.system_reference_date))
                throw new ApiError('يرجى إدخال تاريخ مرجعي صحيح بصيغة YYYY-MM-DD', 400);
            upserts.push({ key: 'system_reference_date', value: payload.system_reference_date });
        }
        if (upserts.length) await safeSupabase(supabase.from('settings').upsert(upserts, { onConflict: 'key' }));
        return api.getSettings();
    },

    // ---- Users (via proxy -> GoTrue Admin API) -------------------------
    getUsers: async () => {
        const available = await checkProxy();
        if (available) {
            try {
                const data = await proxyFetch('/api/users');
                return data;
            } catch {
                // fall through to profiles
            }
        }
        const rows = await safeSupabase(
            supabase.from('profiles').select('id, username, role, created_at').order('created_at')
        );
        return {
            users: (rows || []).map((u) => ({
                id: u.id,
                username: u.username || '',
                role: u.role,
                password: '',
                createdAt: u.created_at,
            })),
        };
    },
    addUser: async (email, password, role) => {
        const data = await proxyFetch('/api/users', {
            method: 'POST',
            body: JSON.stringify({ email, password, role }),
        });
        return { id: data.id, email: data.email, role: data.role };
    },
    deleteUser: async (id) => {
        await proxyFetch(`/api/users/${id}`, { method: 'DELETE' });
        return { message: 'تم حذف المستخدم' };
    },

    // ---- Invite codes (via proxy -> settings table) --------------------
    generateInviteCode: async (role) => {
        const data = await proxyFetch('/api/invite-codes/generate', {
            method: 'POST',
            body: JSON.stringify({ role }),
        });
        return data.code;
    },
    getInviteCodes: async () => {
        const data = await proxyFetch('/api/invite-codes');
        return { codes: data.codes || [] };
    },
    validateInviteCode: async (code) => {
        const data = await proxyFetch(`/api/invite-codes/validate?code=${encodeURIComponent(code)}`);
        return data;
    },
    consumeInviteCode: async (code, userId) => {
        const data = await proxyFetch('/api/invite-codes/consume', {
            method: 'POST',
            body: JSON.stringify({ code, user_id: userId }),
        });
        return data;
    },

    // ---- Audit log ----------------------------------------------------
    getAuditLog: async () => {
        const rows = await safeSupabase(
            supabase
                .from('audit_log')
                .select('id, user_id, username, role, action, details, timestamp')
                .order('id', { ascending: false })
        );
        return {
            log: (rows || []).map((r) => ({
                id: r.id,
                userId: r.user_id,
                username: r.username,
                role: r.role,
                action: r.action,
                details: r.details,
                timestamp: r.timestamp,
            })),
        };
    },

    // ---- Backup -------------------------------------------------------
    exportBackup: () => rpc('export_all'),
    importBackup: async (payload) => {
        const result = await rpc('sync_employees', { p_payload: payload });
        return {
            message: `تمت المزامنة: ${result.created} جديد، ${result.updated} تحديث، ${result.deductions} خصم`,
            ...result,
        };
    },
    serverBackup: async () => {
        await rpc('export_all');
        return { message: 'قاعدة البيانات على Supabase تُنسخ احتياطياً تلقائياً. استخدم "تصدير JSON" لأخذ نسخة محلية.' };
    },
    deleteAllRecords: async () => {
        await safeSupabase(supabase.from('employees').delete().neq('id', 0));
        return { message: 'تم حذف جميع سجلات الموظفين بنجاح' };
    },
};

export { ApiError };
