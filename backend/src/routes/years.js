const express = require('express');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function getYearsList(db) {
    return db.prepare('SELECT year FROM years ORDER BY CAST(year AS INTEGER) ASC').all().map((r) => r.year);
}

router.get('/', requireAuth, (req, res) => {
    const db = getDB();
    res.json({ years: getYearsList(db) });
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
    const db = getDB();
    const { year, defaultAddedDays } = req.body || {};
    const yearStr = year !== undefined && year !== null ? String(year).trim() : '';
    if (!yearStr || !/^\d{4}$/.test(yearStr)) {
        return res.status(400).json({ message: 'يرجى إدخال سنة مالية صحيحة' });
    }
    const existing = db.prepare('SELECT 1 FROM years WHERE year = ?').get(yearStr);
    if (existing) {
        return res.status(400).json({ message: 'هذه السنة مسجلة مسبقاً' });
    }
    const defaultDays = Number(defaultAddedDays);
    const fallbackDefault = Number.isFinite(defaultDays) ? defaultDays : 30;

    const addYear = db.transaction(() => {
        db.prepare('INSERT INTO years (year) VALUES (?)').run(yearStr);
        const employees = db.prepare('SELECT id, over_45 FROM employees').all();
        const insertYear = db.prepare(
            'INSERT INTO employee_years (employee_id, year, added, deducted) VALUES (?, ?, ?, 0)'
        );
        employees.forEach((emp) => {
            insertYear.run(emp.id, yearStr, emp.over_45 ? 45 : fallbackDefault);
        });
    });
    addYear();

    res.status(201).json({ years: getYearsList(db) });
});

router.delete('/:year', requireAuth, requireAdmin, (req, res) => {
    const db = getDB();
    const yearStr = String(req.params.year);
    const existing = db.prepare('SELECT 1 FROM years WHERE year = ?').get(yearStr);
    if (!existing) {
        return res.status(404).json({ message: 'هذه السنة غير موجودة' });
    }
    const totalYears = db.prepare('SELECT COUNT(*) AS c FROM years').get().c;
    if (totalYears <= 1) {
        return res.status(400).json({ message: 'لا يمكن حذف آخر سنة مالية متبقية في النظام' });
    }

    const removeYear = db.transaction(() => {
        db.prepare('DELETE FROM deductions WHERE year = ?').run(yearStr);
        db.prepare('DELETE FROM employee_years WHERE year = ?').run(yearStr);
        db.prepare('DELETE FROM years WHERE year = ?').run(yearStr);
    });
    removeYear();

    res.json({ years: getYearsList(db) });
});

module.exports = router;
