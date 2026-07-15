const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function publicUser(u) {
    return {
        id: u.id,
        username: u.username,
        role: u.role,
        // Only ever populated for data_entry accounts (see POST below) so
        // the admin account's credential is never exposed here.
        password: u.role === 'data_entry' ? u.plain_password || '' : '',
        createdAt: u.created_at,
    };
}

router.get('/', requireAuth, requireAdmin, (req, res) => {
    const db = getDB();
    const users = db.prepare('SELECT * FROM users ORDER BY id ASC').all().map(publicUser);
    res.json({ users });
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
    const db = getDB();
    const { username, password } = req.body || {};
    const uname = username ? String(username).trim() : '';
    if (!uname || !password || String(password).length < 6) {
        return res.status(400).json({ message: 'يرجى إدخال اسم مستخدم وكلمة مرور لا تقل عن 6 أحرف' });
    }
    const existing = db.prepare('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?)').get(uname);
    if (existing) {
        return res.status(400).json({ message: 'اسم المستخدم موجود مسبقاً' });
    }
    const now = new Date().toISOString();
    const info = db
        .prepare(
            'INSERT INTO users (username, password_hash, plain_password, role, created_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(uname, bcrypt.hashSync(String(password), 10), String(password), 'data_entry', now);
    const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ user: publicUser(newUser) });
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
    const db = getDB();
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!target) return res.status(404).json({ message: 'المستخدم غير موجود' });
    if (target.role !== 'data_entry') {
        return res.status(400).json({ message: 'لا يمكن حذف حسابات المدير، فقط مستخدمي إدخال البيانات' });
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    res.json({ message: 'تم حذف المستخدم' });
});

module.exports = router;
