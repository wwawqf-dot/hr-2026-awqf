import { supabase } from '../supabaseClient';

class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

let onAuthExpired = null;
export function setOnAuthExpired(fn) { onAuthExpired = fn; }

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

function isMissingRelation(error) {
    if (!error) return false;
    const msg = (error.message || '').toLowerCase();
    return /relation.*does not exist|does not exist|relation ".+" not found/i.test(msg);
}

function classifyError(error) {
    if (isNetworkError(error)) return { status: 0, message: NETWORK_MSG };
    if (isAuthExpired(error))  return { status: 401, message: SESSION_MSG };
    if (isServerError(error))  return { status: 503, message: SERVER_MSG };
    if (isMissingRelation(error)) return { status: 404, message: 'جدول غير موجود في قاعدة البيانات. يُرجى تشغيل SQL النشر من supabase/deploy-all.sql عبر Dashboard.' };
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

    // ---- Users (admin CRUD via SECURITY DEFINER RPCs) --------------------
    getUsers: async () => {
        const rows = await safeSupabase(
            supabase.from('profiles').select('id, username, role, email, created_at').order('created_at')
        );
        return {
            users: (rows || []).map((u) => ({
                id: u.id,
                username: u.username || '',
                role: u.role,
                email: u.email || '',
                createdAt: u.created_at,
            })),
        };
    },
    updateUserRole: async (userId, newRole) => {
        await rpc('update_user_role', { p_user_id: userId, p_new_role: newRole });
        return { message: 'تم تحديث الصلاحية' };
    },
    deleteUser: async (id) => {
        await rpc('delete_auth_user', { p_id: id });
        return { message: 'تم حذف المستخدم' };
    },

    // ---- Invite codes -------------------------------------------------
    generateInviteCode: async (role) => {
        const rand = Array.from({ length: 10 }, () =>
            Math.floor(Math.random() * 16).toString(16)
        ).join('');
        const code = `WQF-${role}-${rand}`;
        await safeSupabase(
            supabase.from('invite_codes').insert({ code, role })
        );
        return code;
    },
    getInviteCodes: async () => {
        const rows = await safeSupabase(
            supabase.from('invite_codes').select('*').order('created_at', { ascending: false })
        );
        return { codes: rows || [] };
    },
    validateInviteCode: async (code) => {
        try {
            const row = await safeSupabase(
                supabase.from('invite_codes').select('role').eq('code', code).eq('is_used', false).single()
            );
            return { valid: true, role: row.role, code };
        } catch (e) {
            if (e instanceof ApiError && e.status === 406) {
                return { valid: false, error: 'رمز الدعوة غير صحيح أو مستخدم مسبقاً' };
            }
            throw e;
        }
    },
    consumeInviteCode: async (code) => {
        await safeSupabase(
            supabase.rpc('consume_invite_code', { p_code: code })
        );
        return { message: 'تم استهلاك رمز الدعوة' };
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
