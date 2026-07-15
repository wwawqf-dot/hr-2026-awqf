const fs = require('fs');
const path = require('path');
const { getDB } = require('../db');

// Local on-disk backups live next to the backend project root so they travel
// with the app when the folder is copied to another machine.
const BACKUP_DIR = path.resolve(__dirname, '..', '..', 'backups');

function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
}

// Local-time timestamp 'YYYY-MM-DD_HH-mm' for the backup filename.
function fileTimestamp(date = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}`;
}

// Full raw dump of every table so a backup is completely restorable. Reads
// each table defensively so a missing/renamed table never aborts the backup.
function buildFullDump(db) {
    const tables = ['employees', 'employee_years', 'deductions', 'years', 'settings', 'users', 'audit_log'];
    const dump = {};
    tables.forEach((table) => {
        try {
            dump[table] = db.prepare(`SELECT * FROM ${table}`).all();
        } catch {
            dump[table] = [];
        }
    });
    return { version: 1, exportedAt: new Date().toISOString(), tables: dump };
}

// Writes one backup file (prefix_YYYY-MM-DD_HH-mm.json) and returns its info.
function writeBackup(prefix) {
    ensureBackupDir();
    const db = getDB();
    const payload = buildFullDump(db);
    const filename = `${prefix}_${fileTimestamp()}.json`;
    const filepath = path.join(BACKUP_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf8');
    return { filename, filepath, size: fs.statSync(filepath).size };
}

// Silent daily auto-backup on server start. Skips writing if a backup for
// today already exists, so restarting the server many times a day doesn't
// spawn a pile of near-identical files.
function runDailyAutoBackup() {
    try {
        ensureBackupDir();
        const now = new Date();
        const p = (n) => String(n).padStart(2, '0');
        const todayPrefix = `auto_backup_${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
        const alreadyToday = fs.readdirSync(BACKUP_DIR).some((f) => f.startsWith(todayPrefix));
        if (alreadyToday) return null;
        const info = writeBackup('auto_backup');
        console.log(`تم إنشاء نسخة احتياطية تلقائية: ${info.filename}`);
        return info;
    } catch (err) {
        // A backup failure must never crash startup.
        console.error('فشل إنشاء النسخة الاحتياطية التلقائية:', err.message);
        return null;
    }
}

module.exports = { runDailyAutoBackup, writeBackup, BACKUP_DIR };
