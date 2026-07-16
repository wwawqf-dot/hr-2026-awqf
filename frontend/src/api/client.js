import { supabase } from '../supabaseClient';

class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

function must({ data, error }, fallback = 'حدث خطأ غير متوقع') {
    if (error) throw new ApiError(error.message || fallback, error.status || 400);
    return data;
}

async function rpc(fn, args) {
    return must(await supabase.rpc(fn, args));
}

async function listYears() {
    const data = must(await supabase.from('years').select('year'));
    return { years: (data || []).map((r) => r.year).sort((a, b) => Number(a) - Number(b)) };
}

async function listExpiringLeaves(windowDays = 7) {
    const { getLibyaTime } = await import('../utils/libyaTime');
    const today = getLibyaTime();
    const ceiling = getLibyaTime();
    ceiling.setDate(ceiling.getDate() + windowDays);
    const fmt = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const { data, error } = await supabase
        .from('deductions')
        .select('id, end_date, start_date, days, employee:employees(name, job_number)')
        .gte('end_date', fmt(today))
        .lte('end_date', fmt(ceiling))
        .order('end_date');
    if (error) throw new ApiError(error.message, 400);

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
        must(await supabase.from('employees').delete().eq('id', id));
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
        const rows = must(await supabase.from('settings').select('key, value'));
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
        if (upserts.length) must(await supabase.from('settings').upsert(upserts, { onConflict: 'key' }));
        return api.getSettings();
    },

    // ---- Users --------------------------------------------------------
    getUsers: async () => {
        const rows = must(
            await supabase.from('profiles').select('id, username, role, created_at').order('created_at')
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
    addUser: async (payload) => {
        const result = await rpc('create_auth_user', {
            p_email: payload.username,
            p_password: payload.password,
            p_role: payload.role || 'data_entry',
        });
        return { user: result };
    },
    deleteUser: async (id) => {
        await rpc('delete_auth_user', { p_id: id });
        return { message: 'تم حذف المستخدم' };
    },

    // ---- Audit log ----------------------------------------------------
    getAuditLog: async () => {
        const rows = must(
            await supabase
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
        must(await supabase.from('employees').delete().neq('id', 0));
        return { message: 'تم حذف جميع سجلات الموظفين بنجاح' };
    },
};

export { ApiError };
