const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

// Always resolve relative to the backend project root so the app is
// fully portable when the whole folder is copied to another machine.
const DB_PATH = path.resolve(__dirname, '..', process.env.DB_PATH || './database/app.db');

const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || 'admin2026';
const DEFAULT_OPENING_BALANCE_DATE = '2023-12-31';
const DEFAULT_YEARS = ['2025', '2026'];

function ensureDir() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    plain_password TEXT,
    role TEXT NOT NULL CHECK(role IN ('admin', 'data_entry')),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS years (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    job_number TEXT,
    national_id TEXT,
    job_title TEXT,
    initial_carried_forward REAL NOT NULL DEFAULT 0,
    over_45 INTEGER NOT NULL DEFAULT 0,
    is_frozen INTEGER NOT NULL DEFAULT 0,
    hire_date TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employee_years (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    year TEXT NOT NULL,
    added REAL NOT NULL DEFAULT 0,
    deducted REAL NOT NULL DEFAULT 0,
    UNIQUE(employee_id, year)
);

CREATE TABLE IF NOT EXISTS deductions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    year TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    days REAL NOT NULL,
    note TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    role TEXT,
    action TEXT,
    details TEXT,
    timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
`;

let db = null;

// Idempotent migration for databases created before a column existed.
// CREATE TABLE IF NOT EXISTS is a no-op on an existing table, so new
// columns need to be added explicitly for upgrades in place.
function runMigrations() {
    const userColumns = db.prepare('PRAGMA table_info(users)').all();
    const hasPlainPassword = userColumns.some((c) => c.name === 'plain_password');
    if (!hasPlainPassword) {
        db.exec('ALTER TABLE users ADD COLUMN plain_password TEXT');
    }

    const deductionColumns = db.prepare('PRAGMA table_info(deductions)').all();
    const hasNote = deductionColumns.some((c) => c.name === 'note');
    if (!hasNote) {
        db.exec('ALTER TABLE deductions ADD COLUMN note TEXT');
    }

    const employeeColumns = db.prepare('PRAGMA table_info(employees)').all();
    const hasJobNumber = employeeColumns.some((c) => c.name === 'job_number');
    if (!hasJobNumber) {
        db.exec('ALTER TABLE employees ADD COLUMN job_number TEXT');
    }
    const hasIsFrozen = employeeColumns.some((c) => c.name === 'is_frozen');
    if (!hasIsFrozen) {
        db.exec('ALTER TABLE employees ADD COLUMN is_frozen INTEGER NOT NULL DEFAULT 0');
    }
    const hasHireDate = employeeColumns.some((c) => c.name === 'hire_date');
    if (!hasHireDate) {
        db.exec('ALTER TABLE employees ADD COLUMN hire_date TEXT');
    }
}

function seedDefaults() {
    const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
    if (adminCount === 0) {
        db.prepare(
            'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)'
        ).run(DEFAULT_ADMIN_USERNAME, bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 10), 'admin', new Date().toISOString());
    }

    const yearCount = db.prepare('SELECT COUNT(*) AS c FROM years').get().c;
    if (yearCount === 0) {
        const insertYear = db.prepare('INSERT INTO years (year) VALUES (?)');
        DEFAULT_YEARS.forEach((y) => insertYear.run(y));
    }

    const existingSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('openingBalanceDate');
    if (!existingSetting) {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
            'openingBalanceDate',
            DEFAULT_OPENING_BALANCE_DATE
        );
    }

    // Internal reference date all proportional monthly-accrual math reads from
    // (instead of the machine clock). Defaults to today so it is never null.
    const existingRefDate = db.prepare('SELECT value FROM settings WHERE key = ?').get('system_reference_date');
    if (!existingRefDate) {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
            'system_reference_date',
            new Date().toISOString().slice(0, 10)
        );
    }
}

// node:sqlite's DatabaseSync doesn't have better-sqlite3's .pragma()/.transaction()
// convenience methods, so we add thin equivalents on the instance. This keeps every
// route module written against the better-sqlite3-style API working unchanged.
function attachCompatShims(instance) {
    instance.pragma = (statement) => instance.exec(`PRAGMA ${statement}`);
    instance.transaction = (fn) => (...args) => {
        instance.exec('BEGIN');
        try {
            const result = fn(...args);
            instance.exec('COMMIT');
            return result;
        } catch (err) {
            instance.exec('ROLLBACK');
            throw err;
        }
    };
    return instance;
}

function getDB() {
    if (db) return db;
    ensureDir();
    db = attachCompatShims(new DatabaseSync(DB_PATH));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // If another operation holds the write lock, wait up to 5s for it to
    // clear instead of immediately throwing SQLITE_BUSY. WAL mode already
    // lets reads proceed during a write; this covers concurrent writes so
    // the app stays stable over years of use.
    db.pragma('busy_timeout = 5000');
    db.exec(SCHEMA);
    runMigrations();
    seedDefaults();
    return db;
}

module.exports = { getDB, DB_PATH };
