const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = process.env.JWT_EXPIRY || '12h';

router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
        return res.status(400).json({ message: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
    }
    const db = getDB();
    const user = db
        .prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)')
        .get(String(username));
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    const payload = { id: user.id, username: user.username, role: user.role };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
    res.json({ token, user: payload });
});

router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

module.exports = router;
