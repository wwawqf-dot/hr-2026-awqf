const express = require('express');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function getAllSettings(db) {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach((r) => {
        settings[r.key] = r.value;
    });
    return settings;
}

function upsertSetting(db, key, value) {
    db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(key, value);
}

router.get('/', requireAuth, (req, res) => {
    const db = getDB();
    res.json({ settings: getAllSettings(db) });
});

router.put('/', requireAuth, requireAdmin, (req, res) => {
    const db = getDB();
    const { openingBalanceDate, system_reference_date } = req.body || {};
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;

    // Each date is optional so a caller can update just one; whatever is
    // provided must be a valid YYYY-MM-DD.
    if (openingBalanceDate !== undefined) {
        if (!openingBalanceDate || !dateRe.test(openingBalanceDate)) {
            return res.status(400).json({ message: 'يرجى إدخال تاريخ قطع صحيح بصيغة YYYY-MM-DD' });
        }
        upsertSetting(db, 'openingBalanceDate', openingBalanceDate);
    }

    if (system_reference_date !== undefined) {
        if (!system_reference_date || !dateRe.test(system_reference_date)) {
            return res.status(400).json({ message: 'يرجى إدخال تاريخ مرجعي صحيح بصيغة YYYY-MM-DD' });
        }
        upsertSetting(db, 'system_reference_date', system_reference_date);
    }

    res.json({ settings: getAllSettings(db) });
});

module.exports = router;
