const express = require('express');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logAction } = require('../utils/audit');
const { calculateDeductionDays } = require('../utils/days');

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

const RETRO_LIMIT_DAYS = 40;

// The "current today" that operational validations use. Driven by the
// machine's real clock so it advances automatically (the frozen virtual date
// was retired). Returns local 'YYYY-MM-DD'.
function getVirtualToday() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Parses 'YYYY-MM-DD' as a local-midnight Date (timezone-proof).
function parseLocalDate(str) {
    if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
    const [y, m, d] = str.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

// Whole days from `fromStr` to `toStr` (positive when `toStr` is later).
function daysBetween(fromStr, toStr) {
    const from = parseLocalDate(fromStr);
    const to = parseLocalDate(toStr);
    if (!from || !to) return null;
    return Math.round((to - from) / 86400000);
}

// Current net cumulative balance = initial carried-forward + Σ(added - deducted)
// across every tracked year, with strict `|| 0` fallbacks so a null column can
// never poison the arithmetic.
function computeNetBalance(db, empRow) {
    const rows = db.prepare('SELECT added, deducted FROM employee_years WHERE employee_id = ?').all(empRow.id);
    let net = Number(empRow.initial_carried_forward) || 0;
    rows.forEach((r) => {
        net += (Number(r.added) || 0) - (Number(r.deducted) || 0);
    });
    return net;
}

// Register a new deduction for an employee. The financial year is no
// longer chosen manually: it's inferred from the start date, or — for an
// "unknown dates" deduction (a raw day count with no dates) — it falls
// back to the most recently opened (current) financial year.
router.post('/employees/:id/deductions', requireAuth, (req, res) => {
    const db = getDB();
    const empRow = db.prepare('SELECT * FROM employees WHERE id = ?').get(Number(req.params.id));
    if (!empRow) return res.status(404).json({ message: 'الموظف غير موجود' });

    const { start, end, customHolidays, unknownDays, note } = req.body || {};
    const noteVal = note ? String(note).trim().slice(0, 500) : null;
    const years = getYearsList(db);
    const hasDates = Boolean(start && end);
    const hasUnknownDays = unknownDays !== undefined && unknownDays !== null && String(unknownDays).trim() !== '';

    let yearStr;
    let days;
    let startVal = '';
    let endVal = '';
    let isUnknownDate = false;

    if (hasDates) {
        // Read the year straight from the 'YYYY-MM-DD' string rather than
        // `new Date(start).getFullYear()`. The Date route parses as UTC
        // midnight and reads the year in local time, which can roll a
        // 1-Jan deduction back into the previous financial year on
        // non-positive timezones. String parsing is timezone-proof.
        const startYear = String(start).split('-')[0];
        if (!/^\d{4}$/.test(startYear) || !years.includes(startYear)) {
            return res.status(400).json({
                message: `لا توجد سنة مالية نشطة مطابقة لتاريخ البداية (${startYear})`,
            });
        }
        yearStr = startYear;
        days = calculateDeductionDays(start, end, customHolidays, empRow.job_title);
        if (days <= 0) {
            return res.status(400).json({ message: 'يجب أن يكون عدد أيام الخصم أكبر من صفر' });
        }

        // 40-day retroactive limit (dated deductions only). Blocks recording a
        // leave whose start is more than 40 days before the virtual "today".
        // The "unknown dates" path below deliberately bypasses this check.
        const retroDays = daysBetween(start, getVirtualToday());
        if (retroDays !== null && retroDays > RETRO_LIMIT_DAYS) {
            return res.status(400).json({
                message: 'لا يمكن تسجيل إجازة بتاريخ رجعي يتجاوز 40 يوماً من تاريخ النظام الحالي.',
            });
        }

        startVal = start;
        endVal = end;
    } else if (hasUnknownDays) {
        days = Number(unknownDays);
        if (!Number.isFinite(days) || days <= 0) {
            return res.status(400).json({ message: 'يرجى إدخال عدد أيام صحيح أكبر من صفر' });
        }
        if (years.length === 0) {
            return res.status(400).json({ message: 'لا توجد سنة مالية نشطة لتسجيل الخصم' });
        }
        yearStr = years[years.length - 1];
        isUnknownDate = true;
    } else {
        return res.status(400).json({ message: 'يرجى تحديد تاريخ البداية والنهاية أو عدد أيام الخصم' });
    }

    // Insufficient-balance protection (applies to BOTH dated and unknown-date
    // deductions): never let the requested days exceed the employee's current
    // net cumulative balance. Blocks the write before it happens.
    const netBalance = computeNetBalance(db, empRow);
    if (days > netBalance) {
        return res.status(400).json({
            message: 'فشلت العملية: رصيد الموظف الحالي غير كافٍ لتغطية عدد أيام الخصم المطلوبة.',
        });
    }

    const now = new Date().toISOString();
    const addDeduction = db.transaction(() => {
        const existingYearRow = db
            .prepare('SELECT 1 FROM employee_years WHERE employee_id = ? AND year = ?')
            .get(empRow.id, yearStr);
        if (!existingYearRow) {
            db.prepare(
                'INSERT INTO employee_years (employee_id, year, added, deducted) VALUES (?, ?, ?, 0)'
            ).run(empRow.id, yearStr, empRow.over_45 ? 45 : 30);
        }
        db.prepare(
            'UPDATE employee_years SET deducted = deducted + ? WHERE employee_id = ? AND year = ?'
        ).run(days, empRow.id, yearStr);

        db.prepare(
            `INSERT INTO deductions (employee_id, year, start_date, end_date, days, note, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(empRow.id, yearStr, startVal, endVal, days, noteVal, req.user.username, now);
    });
    addDeduction();

    const updatedRow = db.prepare('SELECT * FROM employees WHERE id = ?').get(empRow.id);
    const employee = assembleEmployee(db, updatedRow);
    logAction(
        req.user,
        'تسجيل خصم إجازة',
        `تم خصم ${days} يوم من رصيد ${employee.name} لسنة ${yearStr}${isUnknownDate ? ' (بدون تاريخ محدد)' : ''}`
    );
    res.status(201).json({ employee });
});

// Dashboard widget feed: dated leaves whose end_date falls in a short window
// around today — from 1 day overdue through the next 48 hours — so staff can
// see who is about to return to work. Dateless deductions (end_date = '') are
// excluded. Available to any authenticated user.
router.get('/deductions/expiring', requireAuth, (req, res) => {
    const db = getDB();
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 1); // include slightly-overdue returns
    const to = new Date(today);
    to.setDate(to.getDate() + 2); // next 48 hours

    const rows = db
        .prepare(
            `SELECT e.name AS name, e.job_number AS job_number, d.end_date AS end_date, d.days AS days
             FROM deductions d
             JOIN employees e ON e.id = d.employee_id
             WHERE d.end_date != '' AND d.end_date >= ? AND d.end_date <= ?
             ORDER BY d.end_date ASC, e.name ASC`
        )
        .all(fmt(from), fmt(to));

    res.json({ expiring: rows });
});

// Delete a specific deduction from an employee's history (admin only).
router.delete('/deductions/:deductionId', requireAuth, requireAdmin, (req, res) => {
    const db = getDB();
    const deductionId = Number(req.params.deductionId);
    const deductionRow = db.prepare('SELECT * FROM deductions WHERE id = ?').get(deductionId);
    if (!deductionRow) return res.status(404).json({ message: 'سجل الخصم غير موجود' });

    const removeDeduction = db.transaction(() => {
        db.prepare(
            'UPDATE employee_years SET deducted = MAX(0, deducted - ?) WHERE employee_id = ? AND year = ?'
        ).run(deductionRow.days, deductionRow.employee_id, deductionRow.year);
        db.prepare('DELETE FROM deductions WHERE id = ?').run(deductionId);
    });
    removeDeduction();

    const empRow = db.prepare('SELECT * FROM employees WHERE id = ?').get(deductionRow.employee_id);
    if (!empRow) return res.json({ message: 'تم حذف الخصم' });
    res.json({ employee: assembleEmployee(db, empRow) });
});

module.exports = router;
