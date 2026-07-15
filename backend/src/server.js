require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

if (!process.env.JWT_SECRET) {
    console.error('خطأ: متغير JWT_SECRET غير موجود في ملف .env. يرجى ضبط الإعدادات قبل التشغيل.');
    process.exit(1);
}

const authRoutes = require('./routes/auth');
const employeesRoutes = require('./routes/employees');
const yearsRoutes = require('./routes/years');
const deductionsRoutes = require('./routes/deductions');
const usersRoutes = require('./routes/users');
const auditRoutes = require('./routes/audit');
const settingsRoutes = require('./routes/settings');
const backupRoutes = require('./routes/backup');
const { getDB, DB_PATH } = require('./db');
const { runDailyAutoBackup } = require('./utils/serverBackup');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Initialize (and seed) the SQLite database immediately so startup fails
// fast and loudly if the database file can't be created/opened.
getDB();

// Silent daily on-disk backup (best-effort; never blocks or crashes startup).
runDailyAutoBackup();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', env: NODE_ENV });
});

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/years', yearsRoutes);
app.use('/api', deductionsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/backup', backupRoutes);

// Single-server production mode: serve the built React app from the
// backend so the whole system runs on one port after being copied to
// another machine.
const frontendDist = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get(/^(?!\/api).*/, (req, res) => {
        res.sendFile(path.join(frontendDist, 'index.html'));
    });
}

app.use('/api', (req, res) => {
    res.status(404).json({ message: 'المسار المطلوب غير موجود' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ message: 'حدث خطأ غير متوقع في الخادم' });
});

// Last line of defense: a stray error anywhere must NOT take the whole
// office system down. Log it and keep the process alive so the local
// server survives unattended for years.
process.on('uncaughtException', (err) => {
    console.error('خطأ غير معالَج (uncaughtException):', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('رفض وعد غير معالَج (unhandledRejection):', reason);
});

app.listen(PORT, () => {
    console.log(`تم تشغيل خادم منظومة الإجازات على المنفذ ${PORT} (${NODE_ENV})`);
    console.log(`قاعدة البيانات: ${DB_PATH}`);
});
