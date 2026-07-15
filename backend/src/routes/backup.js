const express = require('express');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { writeBackup } = require('../utils/serverBackup');

const router = express.Router();

function getYearsList(db) {
    return db.prepare('SELECT year FROM years ORDER BY CAST(year AS INTEGER) ASC').all().map((r) => r.year);
}

function assembleEmployee(db, empRow) {
    const yearsRows = db
        .prepare('SELECT year, added, deducted FROM employee_years WHERE employee_id = ?')
        .all(empRow.id);
    const years_data = {};
    yearsRows.forEach((r) => {
        years_data[r.year] = { added: r.added, deducted: r.deducted };
    });

    const deductionsRows = db
        .prepare(
            `SELECT id, year, start_date AS start, end_date AS end, days, note,
                    created_by AS createdBy, created_at AS createdAt
             FROM deductions WHERE employee_id = ? ORDER BY id ASC`
        )
        .all(empRow.id);

    return {
        id: empRow.id,
        name: empRow.name,
        job_number: empRow.job_number || '',
        national_id: empRow.national_id || '',
        job_title: empRow.job_title || '',
        initial_carried_forward: empRow.initial_carried_forward,
        over_45: !!empRow.over_45,
        is_frozen: !!empRow.is_frozen,
        hire_date: empRow.hire_date || '',
        years_data,
        deductions_history: deductionsRows,
        createdAt: empRow.created_at,
    };
}

// Full backup export: employees (with years_data + deductions_history), years,
// and settings. User accounts and the audit log are intentionally excluded —
// password hashes must never leave the server, and restoring old accounts/logs
// isn't part of "restoring the leave data".
router.get('/export', requireAuth, requireAdmin, (req, res) => {
    const db = getDB();
    const years = getYearsList(db);
    const empRows = db.prepare('SELECT * FROM employees ORDER BY id ASC').all();
    const employees = empRows.map((row) => assembleEmployee(db, row));
    const settingsRows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    settingsRows.forEach((r) => {
        settings[r.key] = r.value;
    });

    res.json({
        version: 1,
        exportedAt: new Date().toISOString(),
        years,
        employees,
        settings,
    });
});

// Completely overwrites employees/years/settings with the imported file's
// contents. Runs inside a single transaction so a malformed file leaves the
// database untouched. User accounts and the audit log are never touched.
router.post('/import', requireAuth, requireAdmin, (req, res) => {
    const payload = req.body || {};
    const { years, employees, settings } = payload;

    if (!Array.isArray(years) || years.length === 0) {
        return res.status(400).json({ message: 'ملف الاستيراد غير صالح: قائمة السنوات المالية مفقودة أو فارغة' });
    }
    if (!Array.isArray(employees)) {
        return res.status(400).json({ message: 'ملف الاستيراد غير صالح: قائمة الموظفين مفقودة' });
    }
    for (const year of years) {
        if (!/^\d{4}$/.test(String(year))) {
            return res.status(400).json({ message: `سنة مالية غير صالحة في الملف: ${year}` });
        }
    }
    for (const emp of employees) {
        if (!emp || typeof emp !== 'object' || !emp.name || !String(emp.name).trim()) {
            return res.status(400).json({ message: 'يوجد موظف بدون اسم في ملف الاستيراد' });
        }
    }

    const db = getDB();
    const runImport = db.transaction(() => {
        db.exec('DELETE FROM deductions');
        db.exec('DELETE FROM employee_years');
        db.exec('DELETE FROM employees');
        db.exec('DELETE FROM years');

        const seenYears = new Set();
        const insertYear = db.prepare('INSERT INTO years (year) VALUES (?)');
        years.forEach((y) => {
            const yearStr = String(y);
            if (seenYears.has(yearStr)) return;
            seenYears.add(yearStr);
            insertYear.run(yearStr);
        });

        const insertEmployee = db.prepare(
            `INSERT INTO employees (id, name, job_number, national_id, job_title, initial_carried_forward, over_45, is_frozen, hire_date, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const insertEmpYear = db.prepare(
            'INSERT INTO employee_years (employee_id, year, added, deducted) VALUES (?, ?, ?, ?)'
        );
        const insertDeduction = db.prepare(
            `INSERT INTO deductions (id, employee_id, year, start_date, end_date, days, note, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const insertDeductionAuto = db.prepare(
            `INSERT INTO deductions (employee_id, year, start_date, end_date, days, note, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );

        employees.forEach((emp, index) => {
            const employeeId = Number.isInteger(emp.id) ? emp.id : index + 1;
            insertEmployee.run(
                employeeId,
                String(emp.name).trim(),
                emp.job_number ? String(emp.job_number).trim() : '',
                emp.national_id ? String(emp.national_id).trim() : '',
                emp.job_title ? String(emp.job_title).trim() : '',
                Number(emp.initial_carried_forward) || 0,
                emp.over_45 ? 1 : 0,
                emp.is_frozen ? 1 : 0,
                emp.hire_date ? String(emp.hire_date).trim() : '',
                emp.createdAt || new Date().toISOString()
            );

            Object.entries(emp.years_data || {}).forEach(([year, yd]) => {
                if (!seenYears.has(String(year))) return;
                insertEmpYear.run(employeeId, String(year), Number(yd?.added) || 0, Number(yd?.deducted) || 0);
            });

            // Note: start/end may legitimately be empty strings for
            // "unknown dates" and reconciliation deductions — only a
            // missing/invalid day count or an untracked year disqualifies
            // a row, dates are never required.
            (emp.deductions_history || []).forEach((d) => {
                if (!d || !(Number(d.days) > 0) || !seenYears.has(String(d.year))) return;
                const noteVal = d.note ? String(d.note).trim().slice(0, 500) : null;
                if (Number.isInteger(d.id)) {
                    insertDeduction.run(
                        d.id,
                        employeeId,
                        String(d.year),
                        d.start || '',
                        d.end || '',
                        Number(d.days) || 0,
                        noteVal,
                        d.createdBy || null,
                        d.createdAt || new Date().toISOString()
                    );
                } else {
                    insertDeductionAuto.run(
                        employeeId,
                        String(d.year),
                        d.start || '',
                        d.end || '',
                        Number(d.days) || 0,
                        noteVal,
                        d.createdBy || null,
                        d.createdAt || new Date().toISOString()
                    );
                }
            });
        });

        if (settings && settings.openingBalanceDate && /^\d{4}-\d{2}-\d{2}$/.test(settings.openingBalanceDate)) {
            db.prepare(
                `INSERT INTO settings (key, value) VALUES ('openingBalanceDate', ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
            ).run(settings.openingBalanceDate);
        }
    });

    try {
        runImport();
    } catch (err) {
        return res.status(400).json({ message: 'فشل الاستيراد، لم يتم تعديل أي بيانات: ' + err.message });
    }

    res.json({ message: 'تم استيراد البيانات بنجاح' });
});

// Danger zone: wipes every employee record (and, via ON DELETE CASCADE,
// their per-year balances and deduction history). Years, settings, and
// user accounts are left untouched.
router.delete('/all-records', requireAuth, requireAdmin, (req, res) => {
    const db = getDB();
    db.exec('DELETE FROM employees');
    res.json({ message: 'تم حذف جميع سجلات الموظفين بنجاح' });
});

// Manual on-disk backup: writes a full DB dump to backend/backups as
// manual_backup_YYYY-MM-DD_HH-mm.json and reports the filename back.
router.post('/server-backup', requireAuth, requireAdmin, (req, res) => {
    try {
        const info = writeBackup('manual_backup');
        res.json({ message: `تم إنشاء نسخة احتياطية في الخادم: ${info.filename}`, filename: info.filename });
    } catch (err) {
        res.status(500).json({ message: 'تعذر إنشاء النسخة الاحتياطية في الخادم: ' + err.message });
    }
});

module.exports = router;
