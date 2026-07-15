const express = require('express');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, requireAdmin, (req, res) => {
    const db = getDB();
    const log = db
        .prepare('SELECT id, user_id AS userId, username, role, action, details, timestamp FROM audit_log ORDER BY id DESC')
        .all();
    res.json({ log });
});

module.exports = router;
