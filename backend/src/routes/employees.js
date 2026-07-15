const express = require('express');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logAction } = require('../utils/audit');

const router = express.Router();

// Normalizes the reconciliation note supplied by the frontend. The default
// label lives entirely in the frontend (pre-filled, editable input) — the
// backend never hardcodes a reconciliation string, it just persists whatever
// the admin provided. Capped to keep the column tidy.
function normalizeReconciliationNote(value) {
    return value ? String(value).trim().slice(0, 500) : '';
}

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

// Parses the "actual remaining balance" reconciliation input. Returns null
// if the field was left empty (meaning: no reconciliation requested).
function parseRemainingBalance(value) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : NaN;
}

// Validates the optional hire date. Returns '' when omitted (allowed during
// the staged accrual rollout so existing records can still be edited), the
// trimmed 'YYYY-MM-DD' string when valid, or false when the format is wrong.
function normalizeHireDate(value) {
    if (value === undefined || value === null || String(value).trim() === '') return '';
    const trimmed = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : false;
}

// Mid-year paper-to-digital transition helper: given what the books say an
// employee's cumulative balance was worth by now (past balance + this
// year's addition) versus what's actually left on paper, back-calculate
// how many days must already have been consumed and log that as a
// dateless "خصم بغير تاريخ" deduction tagged with a reconciliation note.
function applyReconciliation(db, { employeeId, year, availableTotal, remainingBalance, note, username }) {
    const consumedDays = availableTotal - remainingBalance;
    if (!(consumedDays > 0)) return 0;

    const now = new Date().toISOString();
    db.prepare(
        'UPDATE employee_years SET deducted = deducted + ? WHERE employee_id = ? AND year = ?'
    ).run(consumedDays, employeeId, year);
    db.prepare(
        `INSERT INTO deductions (employee_id, year, start_date, end_date, days, note, created_by, created_at)
         VALUES (?, ?, '', '', ?, ?, ?, ?)`
    ).run(employeeId, year, consumedDays, note, username, now);
    return consumedDays;
}

// Recomputes an employee's running net cumulative balance the same way the
// frontend table does (initial carried-forward + each year's added - deducted,
// in year order), reading employee_years fresh from the DB.
function computeNetCumulative(db, employeeId, years, initialCarriedForward) {
    const rows = db
        .prepare('SELECT year, added, deducted FROM employee_years WHERE employee_id = ?')
        .all(employeeId);
    const byYear = {};
    rows.forEach((r) => { byYear[r.year] = r; });
    let runningNet = Number(initialCarriedForward) || 0;
    years.forEach((year) => {
        const yd = byYear[year] || { added: 0, deducted: 0 };
        runningNet += (Number(yd.added) || 0) - (Number(yd.deducted) || 0);
    });
    return runningNet;
}

// Admin edit-time reconciliation: forces the employee's net cumulative
// balance to exactly match a paper-record figure by logging the difference
// as a dateless deduction against the current financial year.
function applyEditReconciliation(db, { employeeId, year, netCumulative, remainingBalance, note, username }) {
    const diff = netCumulative - remainingBalance;
    if (!(diff > 0)) return 0;

    const now = new Date().toISOString();
    db.prepare(
        'UPDATE employee_years SET deducted = deducted + ? WHERE employee_id = ? AND year = ?'
    ).run(diff, employeeId, year);
    db.prepare(
        `INSERT INTO deductions (employee_id, year, start_date, end_date, days, note, created_by, created_at)
         VALUES (?, ?, '', '', ?, ?, ?, ?)`
    ).run(employeeId, year, diff, note, username, now);
    return diff;
}

router.get('/', requireAuth, (req, res) => {
    const db = getDB();
    const years = getYearsList(db);
    const empRows = db.prepare('SELECT * FROM employees ORDER BY id ASC').all();
    const employees = empRows.map((row) => assembleEmployee(db, row));
    res.json({ employees, years });
});

router.post('/', requireAuth, (req, res) => {
    const db = getDB();
    const years = getYearsList(db);
    const {
        name, job_number, national_id, job_title, initial_carried_forward, over_45, years_data,
        actualRemainingBalance, reconciliationNote, hire_date,
    } = req.body || {};
    if (!name || !String(name).trim()) {
        return res.status(400).json({ message: 'يرجى إدخال اسم الموظف كاملاً' });
    }
    const hireDateVal = normalizeHireDate(hire_date);
    if (hireDateVal === false) {
        return res.status(400).json({ message: 'تاريخ المباشرة يجب أن يكون بصيغة YYYY-MM-DD' });
    }
    const reconNote = normalizeReconciliationNote(reconciliationNote);
    const isOver45 = Boolean(over_45);
    const initialCarried = Number(initial_carried_forward) || 0;
    const now = new Date().toISOString();

    const remainingBalance = parseRemainingBalance(actualRemainingBalance);
    if (Number.isNaN(remainingBalance)) {
        return res.status(400).json({ message: 'الرصيد المتبقي الفعلي يجب أن يكون رقماً' });
    }
    const currentYear = years[years.length - 1];

    let reconciliationDays = 0;

    const insertEmployee = db.transaction(() => {
        const info = db
            .prepare(
                `INSERT INTO employees (name, job_number, national_id, job_title, initial_carried_forward, over_45, hire_date, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                String(name).trim(),
                job_number ? String(job_number).trim() : '',
                national_id ? String(national_id).trim() : '',
                job_title ? String(job_title).trim() : '',
                initialCarried,
                isOver45 ? 1 : 0,
                hireDateVal || '',
                now
            );
        const employeeId = info.lastInsertRowid;

        const insertYear = db.prepare(
            'INSERT INTO employee_years (employee_id, year, added, deducted) VALUES (?, ?, ?, 0)'
        );
        let currentYearAdded = isOver45 ? 45 : 30;
        years.forEach((year) => {
            const entry = years_data && years_data[year];
            const added = Number(entry && entry.added);
            const addedVal = Number.isFinite(added) ? added : isOver45 ? 45 : 30;
            insertYear.run(employeeId, year, addedVal);
            if (year === currentYear) currentYearAdded = addedVal;
        });

        if (remainingBalance !== null && currentYear) {
            reconciliationDays = applyReconciliation(db, {
                employeeId,
                year: currentYear,
                availableTotal: initialCarried + currentYearAdded,
                remainingBalance,
                note: reconNote,
                username: req.user.username,
            });
        }

        return employeeId;
    });

    const employeeId = insertEmployee();
    const empRow = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
    const employee = assembleEmployee(db, empRow);
    logAction(
        req.user,
        'إضافة موظف',
        `تمت إضافة الموظف: ${employee.name}${reconciliationDays > 0 ? ` (تسوية جرد: خصم ${reconciliationDays} يوم)` : ''}`
    );
    res.status(201).json({ employee });
});

// Bulk-onboard employees parsed from an uploaded Excel/CSV file on the
// frontend. Each row only needs name/national_id/job_title — every other
// property (balances, over_45, deductions) is set to the system defaults
// so the admin can fill in the rest later. Rows without a name are skipped
// rather than failing the whole batch. An optional remainingBalance per
// row triggers the same paper-reconciliation deduction as manual entry.
router.post('/bulk', requireAuth, requireAdmin, (req, res) => {
    const db = getDB();
    const years = getYearsList(db);
    const rows = (req.body && req.body.employees) || [];

    if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: 'لا توجد بيانات موظفين صالحة للاستيراد' });
    }

    const currentYear = years[years.length - 1];
    const defaultAddedForCurrentYear = 30; // bulk-imported employees always default to over_45 = false
    // Batch-level reconciliation note (the frontend supplies the label); the
    // backend keeps no hardcoded reconciliation string.
    const bulkReconNote = normalizeReconciliationNote(req.body && req.body.reconciliationNote);
    const now = new Date().toISOString();
    const insertEmployee = db.prepare(
        `INSERT INTO employees (name, job_number, national_id, job_title, initial_carried_forward, over_45, created_at)
         VALUES (?, ?, ?, ?, 0, 0, ?)`
    );
    const insertYear = db.prepare(
        'INSERT INTO employee_years (employee_id, year, added, deducted) VALUES (?, ?, 30, 0)'
    );

    let createdCount = 0;
    let skippedCount = 0;
    let reconciledCount = 0;
    const createdIds = [];

    const runBulk = db.transaction(() => {
        rows.forEach((row) => {
            const name = row && row.name ? String(row.name).trim() : '';
            if (!name) {
                skippedCount++;
                return;
            }
            const job_number = row.job_number ? String(row.job_number).trim() : '';
            const national_id = row.national_id ? String(row.national_id).trim() : '';
            const job_title = row.job_title ? String(row.job_title).trim() : '';

            const info = insertEmployee.run(name, job_number, national_id, job_title, now);
            const employeeId = info.lastInsertRowid;
            years.forEach((year) => insertYear.run(employeeId, year));
            createdIds.push(employeeId);
            createdCount++;

            const remainingBalance = parseRemainingBalance(row.remainingBalance);
            if (remainingBalance !== null && !Number.isNaN(remainingBalance) && currentYear) {
                const consumed = applyReconciliation(db, {
                    employeeId,
                    year: currentYear,
                    availableTotal: defaultAddedForCurrentYear,
                    remainingBalance,
                    note: bulkReconNote,
                    username: req.user.username,
                });
                if (consumed > 0) reconciledCount++;
            }
        });
    });
    runBulk();

    const empRows = createdIds.length
        ? db.prepare(`SELECT * FROM employees WHERE id IN (${createdIds.map(() => '?').join(',')})`).all(...createdIds)
        : [];
    const employees = empRows.map((row) => assembleEmployee(db, row));

    res.status(201).json({ created: createdCount, skipped: skippedCount, reconciled: reconciledCount, employees });
});

router.put('/:id', requireAuth, requireAdmin, (req, res) => {
    const db = getDB();
    const empRow = db.prepare('SELECT * FROM employees WHERE id = ?').get(Number(req.params.id));
    if (!empRow) return res.status(404).json({ message: 'الموظف غير موجود' });

    const {
        name, job_number, national_id, job_title, initial_carried_forward, over_45, years_data,
        actualRemainingBalance, reconciliationNote, hire_date,
    } = req.body || {};
    if (!name || !String(name).trim()) {
        return res.status(400).json({ message: 'يرجى إدخال اسم الموظف كاملاً' });
    }

    const hireDateVal = normalizeHireDate(hire_date);
    if (hireDateVal === false) {
        return res.status(400).json({ message: 'تاريخ المباشرة يجب أن يكون بصيغة YYYY-MM-DD' });
    }
    const reconNote = normalizeReconciliationNote(reconciliationNote);
    const remainingBalance = parseRemainingBalance(actualRemainingBalance);
    if (Number.isNaN(remainingBalance)) {
        return res.status(400).json({ message: 'الرصيد المتبقي الفعلي يجب أن يكون رقماً' });
    }

    const years = getYearsList(db);
    const currentYear = years[years.length - 1];
    const newInitialCarried = Number(initial_carried_forward) || 0;
    let editReconciliationDays = 0;

    const update = db.transaction(() => {
        db.prepare(
            `UPDATE employees SET name = ?, job_number = ?, national_id = ?, job_title = ?, initial_carried_forward = ?, over_45 = ?, hire_date = ?
             WHERE id = ?`
        ).run(
            String(name).trim(),
            job_number ? String(job_number).trim() : '',
            national_id ? String(national_id).trim() : '',
            job_title ? String(job_title).trim() : '',
            newInitialCarried,
            Boolean(over_45) ? 1 : 0,
            hireDateVal || '',
            empRow.id
        );

        if (years_data) {
            const upsert = db.prepare(
                `INSERT INTO employee_years (employee_id, year, added, deducted) VALUES (?, ?, ?, 0)
                 ON CONFLICT(employee_id, year) DO UPDATE SET added = excluded.added`
            );
            Object.keys(years_data).forEach((year) => {
                const entry = years_data[year];
                const added = Number(entry && entry.added);
                if (Number.isFinite(added)) {
                    upsert.run(empRow.id, year, added);
                }
            });
        }

        if (remainingBalance !== null && currentYear) {
            const netCumulative = computeNetCumulative(db, empRow.id, years, newInitialCarried);
            editReconciliationDays = applyEditReconciliation(db, {
                employeeId: empRow.id,
                year: currentYear,
                netCumulative,
                remainingBalance,
                note: reconNote,
                username: req.user.username,
            });
        }
    });
    update();

    const updatedRow = db.prepare('SELECT * FROM employees WHERE id = ?').get(empRow.id);
    res.json({ employee: assembleEmployee(db, updatedRow), reconciliationDays: editReconciliationDays });
});

// Toggle an employee's frozen status (admin only). Frozen employees are
// pushed to the bottom of the table and marked with a "مُجمّد" badge; no
// data is deleted, so freezing is fully reversible.
router.put('/:id/freeze', requireAuth, requireAdmin, (req, res) => {
    const db = getDB();
    const empRow = db.prepare('SELECT * FROM employees WHERE id = ?').get(Number(req.params.id));
    if (!empRow) return res.status(404).json({ message: 'الموظف غير موجود' });

    const nextFrozen = empRow.is_frozen ? 0 : 1;
    db.prepare('UPDATE employees SET is_frozen = ? WHERE id = ?').run(nextFrozen, empRow.id);

    const updatedRow = db.prepare('SELECT * FROM employees WHERE id = ?').get(empRow.id);
    res.json({ employee: assembleEmployee(db, updatedRow) });
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
    const db = getDB();
    const empRow = db.prepare('SELECT * FROM employees WHERE id = ?').get(Number(req.params.id));
    if (!empRow) return res.status(404).json({ message: 'الموظف غير موجود' });
    db.prepare('DELETE FROM employees WHERE id = ?').run(empRow.id);
    res.json({ message: 'تم حذف الموظف' });
});

module.exports = router;
