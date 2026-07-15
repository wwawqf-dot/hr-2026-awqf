const { getDB } = require('../db');

// Per spec, the audit log records actions performed by Data Entry users only.
function logAction(user, action, details) {
    if (!user || user.role !== 'data_entry') return;
    const db = getDB();
    db.prepare(
        'INSERT INTO audit_log (user_id, username, role, action, details, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user.id, user.username, user.role, action, details, new Date().toISOString());
}

module.exports = { logAction };
