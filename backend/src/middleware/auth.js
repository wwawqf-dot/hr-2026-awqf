const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
        return res.status(401).json({ message: 'يجب تسجيل الدخول أولاً' });
    }
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = payload;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'انتهت الجلسة أو الرمز غير صالح، الرجاء تسجيل الدخول مجدداً' });
    }
}

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'هذا الإجراء متاح لمدير النظام فقط' });
    }
    next();
}

module.exports = { requireAuth, requireAdmin };
