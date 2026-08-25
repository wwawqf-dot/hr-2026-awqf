import { useRef, useState } from 'react';
import PageHeader from './PageHeader';
import LoadingSpinner from './LoadingSpinner';
import { TableSkeleton } from './SkeletonLoader';
import ConfirmDangerModal from './modals/ConfirmDangerModal';
import { getLibyaDateStr, getLibyaYear } from '../utils/libyaTime';
import { logActivity } from '../api/client';

// Structural validation of an imported backup file, run BEFORE anything is
// sent to the sync RPC. Returns a user-friendly Arabic error string, or ''
// when the payload is safe. This is what stands between a corrupted /
// hand-edited JSON file and a confusing failure mid-import.
function validateBackupPayload(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return 'صيغة الملف غير صالحة: المحتوى ليس كائن JSON.';
    }
    if (!Array.isArray(parsed.years) || parsed.years.length === 0) {
        return 'صيغة الملف غير صالحة: قائمة السنوات المالية (years) مفقودة أو فارغة.';
    }
    for (const y of parsed.years) {
        if (!/^\d{4}$/.test(String(y))) {
            return `صيغة الملف غير صالحة: سنة مالية غير صحيحة (${y}).`;
        }
    }
    if (!Array.isArray(parsed.employees)) {
        return 'صيغة الملف غير صالحة: قائمة الموظفين (employees) مفقودة.';
    }
    for (let i = 0; i < parsed.employees.length; i++) {
        const emp = parsed.employees[i];
        if (!emp || typeof emp !== 'object' || Array.isArray(emp)) {
            return `صيغة الملف غير صالحة: العنصر رقم ${i + 1} في قائمة الموظفين ليس سجلاً صحيحاً.`;
        }
        if (!emp.name || !String(emp.name).trim()) {
            return `صيغة الملف غير صالحة: الموظف رقم ${i + 1} بدون اسم.`;
        }
        if (emp.years_data !== undefined && (typeof emp.years_data !== 'object' || Array.isArray(emp.years_data) || emp.years_data === null)) {
            return `صيغة الملف غير صالحة: بيانات السنوات (years_data) للموظف "${emp.name}" ليست بالشكل الصحيح.`;
        }
        if (emp.deductions_history !== undefined && !Array.isArray(emp.deductions_history)) {
            return `صيغة الملف غير صالحة: سجل الخصومات للموظف "${emp.name}" ليس قائمة.`;
        }
    }
    return '';
}

// `leaveData` is the single useLeaveData() instance owned by App.jsx and
// shared with EmployeesPage — see the comment in App.jsx for why this is
// no longer called independently here.
export default function SettingsPage({ leaveData }) {
    const {
        years, settings, loading, error, addYear, deleteYear, updateSettings,
        exportBackup, importBackup, deleteAllRecords,
        getArchivedEmployees, restoreEmployee, getArchivedYears, restoreYear,
        finalizeYear, listYearArchives, getYearArchive, reconcileCounters,
    } = leaveData;

    const [reconciling, setReconciling] = useState(false);

    const [newYear, setNewYear] = useState('');
    const [defaultAdded, setDefaultAdded] = useState(30);
    const [yearError, setYearError] = useState('');
    const [savingYear, setSavingYear] = useState(false);

    const [backupError, setBackupError] = useState('');
    const [backupSuccess, setBackupSuccess] = useState('');
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [showDangerModal, setShowDangerModal] = useState(false);
    const fileInputRef = useRef(null);

    // Trash bin: loaded lazily (only once the admin expands the panel),
    // since this is a rarely-used view and shouldn't add a request to
    // every routine Settings page load.
    const [archiveOpen, setArchiveOpen] = useState(false);
    const [archiveLoaded, setArchiveLoaded] = useState(false);
    const [archiveLoading, setArchiveLoading] = useState(false);
    const [archiveError, setArchiveError] = useState('');
    const [archivedEmployees, setArchivedEmployees] = useState([]);
    const [archivedYears, setArchivedYears] = useState([]);
    const [restoringKey, setRestoringKey] = useState(null);

    async function loadArchive() {
        setArchiveLoading(true);
        setArchiveError('');
        try {
            const [emps, yrs] = await Promise.all([getArchivedEmployees(), getArchivedYears()]);
            setArchivedEmployees(emps);
            setArchivedYears(yrs);
            setArchiveLoaded(true);
        } catch (err) {
            setArchiveError(err.message || 'تعذر تحميل الأرشيف');
        } finally {
            setArchiveLoading(false);
        }
    }

    function toggleArchive() {
        const next = !archiveOpen;
        setArchiveOpen(next);
        if (next && !archiveLoaded) loadArchive();
    }

    async function handleRestoreEmployee(emp) {
        setRestoringKey(`emp-${emp.id}`);
        setArchiveError('');
        try {
            await restoreEmployee(emp.id);
            logActivity('استعادة موظف', `تم استعادة الموظف "${emp.name}" من الأرشيف`).catch(() => {});
            setArchivedEmployees((prev) => prev.filter((e) => e.id !== emp.id));
        } catch (err) {
            setArchiveError(err.message || 'تعذر استعادة الموظف');
        } finally {
            setRestoringKey(null);
        }
    }

    async function handleRestoreYear(year) {
        setRestoringKey(`year-${year}`);
        setArchiveError('');
        try {
            await restoreYear(year);
            logActivity('استعادة سنة مالية', `تم استعادة السنة المالية ${year} من الأرشيف`).catch(() => {});
            setArchivedYears((prev) => prev.filter((y) => y !== year));
        } catch (err) {
            setArchiveError(err.message || 'تعذر استعادة السنة المالية');
        } finally {
            setRestoringKey(null);
        }
    }

    async function handleAddYear(e) {
        e.preventDefault();
        setYearError('');
        const yearStr = String(newYear).trim();
        if (!/^\d{4}$/.test(yearStr) || years.includes(yearStr)) {
            setYearError('يرجى إدخال سنة مالية صحيحة وغير مكررة');
            return;
        }
        const lastYear = years.length > 0 ? years[years.length - 1] : '—';
        const msg =
            `هل أنت متأكد من إضافة السنة المالية ${yearStr}؟\n\n` +
            `سيتم ترحيل الأرصدة من سنة ${lastYear} تلقائياً مع تقريب الرصيد التراكمي النهائي (CEIL) إلى أعلى عدد صحيح.\n\n` +
            `تُضاف أيام السنة كاملةً الآن ودفعة واحدة: ${defaultAdded} يوم لكل موظف، و 45 يوماً لمن تنطبق عليه شروط الـ 45، وبالتناسب لمن يُعيّن خلال السنة. لا يوجد احتساب شهري بعد ذلك، ولا يمكن التراجع عن هذه العملية.\n\n` +
            `يرجى التأكد من الانتهاء من تسجيل جميع خصومات سنة ${lastYear} قبل المتابعة.`;
        if (!window.confirm(msg)) return;

        setSavingYear(true);
        try {
            await addYear({ year: yearStr, defaultAddedDays: Number(defaultAdded) || 0 });
            logActivity('إضافة سنة مالية', `تم إضافة السنة المالية ${yearStr}`).catch(() => {});
            setNewYear('');
        } catch (err) {
            setYearError(err.message || 'تعذر إضافة السنة المالية');
        } finally {
            setSavingYear(false);
        }
    }

    async function downloadBackupFile() {
        const data = await exportBackup();
        const dataStr = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
        const a = document.createElement('a');
        a.setAttribute('href', dataStr);
        a.setAttribute('download', 'نسخة_تصدير_منظومة_الإجازات_' + getLibyaDateStr() + '.json');
        document.body.appendChild(a);
        a.click();
        a.remove();
        return data;
    }

    async function handleDeleteYear(year) {
        // Soft delete (archive_year RPC): the year and every deduction/
        // employee_years row tied to it are left completely intact — only
        // hidden. No forced pre-delete backup needed anymore, since there
        // is nothing irreversible here; it can be undone any time from
        // "أرشيف السنوات المالية" below.
        if (
            !window.confirm(
                `سيختفي السنة ${year} فوراً من كل الشاشات والتقارير، لكن جميع الأيام المضافة والخصومات المرتبطة بها لكل الموظفين تبقى محفوظة بأمان ويمكن استعادتها لاحقاً من "أرشيف السنوات المالية" أدناه. هل تريد المتابعة؟`
            )
        )
            return;

        try {
            await deleteYear(year);
            logActivity('أرشفة سنة مالية', `تم أرشفة السنة المالية ${year} — اختفت من كل الشاشات ويمكن استعادتها من الأرشيف`).catch(() => {});
        } catch (err) {
            alert(err.message || 'تعذر حذف السنة المالية');
        }
    }

    // Isolated yearly archive: freezes the year's full data (employees +
    // that year's balances + that year's deduction register) into its own
    // separate sealed snapshot. The live tables are never touched.
    const [freezingKey, setFreezingKey] = useState(null);
    const [archives, setArchives] = useState([]);
    const [archivesLoading, setArchivesLoading] = useState(false);
    const [archivesOpen, setArchivesOpen] = useState(false);
    const [archivesError, setArchivesError] = useState('');
    const [archivesLoaded, setArchivesLoaded] = useState(false);

    async function loadArchives() {
        setArchivesLoading(true);
        setArchivesError('');
        try {
            setArchives(await listYearArchives());
            setArchivesLoaded(true);
        } catch (err) {
            setArchivesError(err.message || 'تعذر تحميل أرشيف السنوات');
        } finally {
            setArchivesLoading(false);
        }
    }

    function toggleArchives() {
        const next = !archivesOpen;
        setArchivesOpen(next);
        if (next && !archivesLoaded) loadArchives();
    }

    async function handleFinalizeYear(year) {
        if (
            !window.confirm(
                `سيتم حفظ سنة ${year} كاملة في أرشيف منفصل (لقطة مجمّدة: الموظفون + أرصدة السنة + سجل خصوماتها).\nالبيانات الحية لا تتغير نهائياً وتبقى السنة ظاهرة هنا كما هي.\nهل تريد المتابعة؟`
            )
        )
            return;
        setFreezingKey(`year-${year}`);
        setArchivesError('');
        try {
            await finalizeYear(year);
            logActivity('أرشفة سنة مالية منفصلة', `تم حفظ الأرشيف المنفصل للسنة ${year}`).catch(() => {});
            await loadArchives();
        } catch (err) {
            setArchivesError(err.message || 'تعذر أرشفة السنة');
        } finally {
            setFreezingKey(null);
        }
    }

    async function handleExportYearArchive(year) {
        setArchivesError('');
        try {
            const snapshot = await getYearArchive(year);
            const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `أرشيف_سنة_${year}_${getLibyaDateStr()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            setArchivesError(err.message || 'تعذر تصدير أرشيف السنة');
        }
    }

    async function handleExport() {
        setBackupError('');
        setBackupSuccess('');
        setExporting(true);
        try {
            await downloadBackupFile();
            setBackupSuccess('تم تصدير نسخة الاحتياط بنجاح.');
        } catch (err) {
            setBackupError(err.message || 'تعذر تصدير النسخة');
        } finally {
            setExporting(false);
        }
    }

    async function handleImportFile(e) {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        setBackupError('');
        setBackupSuccess('');

        let parsed;
        try {
            const text = await file.text();
            parsed = JSON.parse(text);
        } catch (err) {
            setBackupError('تعذر قراءة الملف: يجب أن يكون ملف JSON صالح.');
            return;
        }

        const structuralError = validateBackupPayload(parsed);
        if (structuralError) {
            setBackupError(structuralError);
            return;
        }

        if (
            !window.confirm(
                `تم العثور على ${parsed.employees.length} موظف و ${parsed.years.length} سنة مالية في الملف.\nسيتم دمج هذه البيانات مع البيانات الحالية (مطابقة عبر الرقم الوظيفي أو المعرّف، بدون تكرار).\nهل أنت متأكد من المتابعة؟`
            )
        ) {
            return;
        }

        setImporting(true);
        try {
            await importBackup(parsed);
            setBackupSuccess('تم استيراد البيانات بنجاح.');
        } catch (err) {
            setBackupError(err.message || 'تعذر استيراد الملف');
        } finally {
            setImporting(false);
        }
    }

    async function handleDeleteAll() {
        await deleteAllRecords();
        setBackupError('');
        setBackupSuccess('تم حذف جميع سجلات الموظفين بنجاح.');
    }

    // Audits every employee-year counter against the deduction register it
    // is supposed to summarise. Imports repair themselves now, so this is
    // for data that predates that fix.
    async function handleReconcile() {
        setBackupError('');
        setBackupSuccess('');
        setReconciling(true);
        try {
            const result = await reconcileCounters();
            const fixed = result?.fixed ?? 0;              // deduction counters
            const allocFixed = result?.allocFixed ?? 0;    // stale yearly grants
            const allocAdded = result?.allocAdded ?? 0;    // grants that were missing outright
            const blocked = result?.blocked ?? [];
            logActivity(
                'مطابقة الأرصدة والعدّادات',
                `عدّادات: ${fixed}، أرصدة سنوية: ${allocFixed}، صفوف مضافة: ${allocAdded}، متعذّرة: ${blocked.length}`
            ).catch(() => {});

            const done = [];
            if (fixed) done.push(`${fixed} عدّاد خصم`);
            if (allocFixed) done.push(`${allocFixed} رصيد سنوي`);
            if (allocAdded) done.push(`${allocAdded} موظف لم يكن له رصيد مسجّل لهذه السنة`);
            setBackupSuccess(
                done.length === 0
                    ? 'تمت المطابقة: جميع الأرصدة والعدّادات سليمة، ولا يوجد ما يحتاج تصحيحاً.'
                    : `تمت المطابقة وتصحيح: ${done.join('، ')}.`
            );

            // A grant that would land below the days the employee has
            // already taken is never written silently — it is named here
            // so a human can settle it.
            if (blocked.length) {
                setBackupError(
                    'تعذّر تصحيح رصيد الموظفين التالين لأن الرصيد الصحيح أقل من الإجازات المخصومة لهم فعلاً، ' +
                    'ويحتاج الأمر لمراجعة يدوية: ' +
                    blocked
                        .map((b) => `${b.employee} (المسجّل ${b.stored} / الصحيح ${b.correct} / المخصوم ${b.deducted})`)
                        .join('، ')
                );
            }
        } catch (err) {
            setBackupError(err.message || 'تعذر تنفيذ المطابقة');
        } finally {
            setReconciling(false);
        }
    }

    return (
        <>
            <PageHeader />

            <div className="panel">


                <div style={{ borderTop: '1px dashed var(--table-border)', margin: '1.5rem 0 1rem' }}></div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    <i className="fas fa-shield-alt" style={{ color: '#60a5fa', marginLeft: 6 }}></i>
                    يعتمد النظام على توقيت شبكة آمن ومستقل (توقيت ليبيا - Africa/Tripoli) لمنع أي تلاعب في تواريخ الأجهزة المحلية، مما يضمن دقة قيد الـ 40 يوماً للخصم بأثر رجعي.
                </p>
            </div>

            <div className="panel">
                <h2><i className="fas fa-calendar-plus"></i> إدارة السنوات المالية</h2>
                {yearError && <div className="form-error">{yearError}</div>}
                <form className="inline-form" onSubmit={handleAddYear}>
                    <div className="form-group">
                        <label>السنة المالية الجديدة</label>
                        <input
                            type="number"
                            value={newYear}
                            onChange={(e) => setNewYear(e.target.value)}
                            placeholder={getLibyaYear()}
                        />
                    </div>
                    <div className="form-group">
                        <label>المضاف القياسي الافتراضي (لغير المستثنين)</label>
                        <input
                            type="number"
                            value={defaultAdded}
                            onChange={(e) => setDefaultAdded(e.target.value)}
                        />
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={savingYear}>
                        {savingYear && <LoadingSpinner size={16} color="#fff" style={{ marginLeft: 8 }} />}
                        <i className="fas fa-plus"></i> {savingYear ? 'جاري الإضافة...' : 'إضافة سنة'}
                    </button>
                </form>

                {error && <div className="form-error">{error}</div>}

                {loading ? (
                    <div className="table-container" style={{ maxHeight: 'none', padding: 0, overflow: 'hidden' }}>
                        <TableSkeleton rows={3} cols={2} />
                    </div>
                ) : (
                    <div className="table-container" style={{ maxHeight: 'none' }}>
                        <table>
                            <thead>
                                <tr>
                                    <th>السنة المالية</th>
                                    <th style={{ textAlign: 'center' }}>الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody>
                                {years.map((year) => (
                                    <tr key={year}>
                                        <td style={{ fontWeight: 700, color: 'var(--emerald)' }}>سنة {year}</td>
                                        <td style={{ textAlign: 'center' }}>
                                            <button
                                                className="btn btn-icon-text btn-outline"
                                                onClick={() => handleFinalizeYear(year)}
                                                title="أرشفة هذه السنة في مكان منفصل (لقطة كاملة)"
                                                disabled={freezingKey === `year-${year}`}
                                                style={{ marginLeft: 8 }}
                                            >
                                                {freezingKey === `year-${year}` && <LoadingSpinner size={14} color="#10b981" style={{ marginLeft: 6 }} />}
                                                <i className="fas fa-box-archive"></i> أرشفة منفصلة
                                            </button>
                                            <button
                                                className="btn btn-icon btn-danger-outline"
                                                onClick={() => handleDeleteYear(year)}
                                                title="حذف السنة"
                                                disabled={years.length <= 1}
                                            >
                                                <i className="fas fa-trash"></i>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="panel">
                <h2><i className="fas fa-database"></i> النسخ الاحتياطي والاستعادة</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
                    احفظ نسخة كاملة من بيانات الموظفين والسنوات المالية والإعدادات، أو استورد نسخة سابقة لتحل محل
                    البيانات الحالية بالكامل.
                </p>
                {backupError && <div className="form-error">{backupError}</div>}
                {backupSuccess && (
                    <div
                        className="form-error"
                        style={{
                            background: 'rgba(16, 185, 129, 0.1)',
                            borderColor: 'rgba(16, 185, 129, 0.35)',
                            color: 'var(--emerald)',
                        }}
                    >
                        {backupSuccess}
                    </div>
                )}
                <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
                    <button className="btn btn-outline" onClick={handleExport} disabled={exporting}>
                        {exporting && <LoadingSpinner size={16} color="#10b981" style={{ marginLeft: 8 }} />}
                        <i className="fas fa-file-export"></i> {exporting ? 'جاري التصدير...' : 'تصدير نسخة احتياطية'}
                    </button>
                    <button
                        type="button"
                        className="btn btn-warning-outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={importing}
                    >
                        {importing && <LoadingSpinner size={16} color="#f59e0b" style={{ marginLeft: 8 }} />}
                        <i className="fas fa-file-import"></i> {importing ? 'جاري الاستيراد...' : 'استيراد نسخة احتياطية'}
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,application/json"
                        style={{ display: 'none' }}
                        onChange={handleImportFile}
                    />
                    <button
                        type="button"
                        className="btn btn-outline"
                        onClick={handleReconcile}
                        disabled={reconciling}
                        title="يعيد حساب الرصيد السنوي المضاف وعدّادات الخصم لكل موظف ويصحّح أي فرق"
                    >
                        {reconciling && <LoadingSpinner size={16} color="#10b981" style={{ marginLeft: 8 }} />}
                        <i className="fas fa-scale-balanced"></i> {reconciling ? 'جاري المطابقة...' : 'مطابقة الأرصدة والعدّادات'}
                    </button>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.9rem' }}>
                    <i className="fas fa-circle-info" style={{ color: '#60a5fa', marginLeft: 6 }}></i>
                    "مطابقة الأرصدة والعدّادات" تصحّح أمرين للسنة المالية الحالية فقط: الرصيد السنوي المضاف لكل موظف (30 يوماً، أو 45 لمن تنطبق عليه الشروط، أو بالتناسب لمن عُيّن خلال السنة) — وهو ما يعالج من غُيّرت صفته بعد فتح السنة أو من استُعيد من الأرشيف بلا رصيد — وأيام الخصم المسجّلة، من سجل خصوماته الفعلي. السنوات المغلقة والمؤرشفة لا تُمسّ.
                </p>
            </div>

            <div className="panel">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: archiveOpen ? '1.25rem' : 0 }}>
                    <h2 style={{ margin: 0 }}><i className="fas fa-box-archive"></i> أرشيف الموظفين والسنوات المالية</h2>
                    <button type="button" className="btn btn-outline" onClick={toggleArchive}>
                        <i className={`fas fa-chevron-${archiveOpen ? 'up' : 'down'}`}></i> {archiveOpen ? 'إخفاء الأرشيف' : 'عرض الأرشيف'}
                    </button>
                </div>

                {archiveOpen && (
                    <>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                            حذف موظف أو سنة مالية لا يمسح بياناتها فعلياً — فقط يخفيها من كل الشاشات والتقارير. تظهر هنا وتُستعاد بضغطة واحدة في أي وقت.
                        </p>

                        {archiveError && <div className="form-error">{archiveError}</div>}

                        {archiveLoading ? (
                            <div className="empty-state">جاري تحميل الأرشيف...</div>
                        ) : (
                            <>
                                <h4 style={{ color: '#60a5fa', fontSize: '0.9rem', marginBottom: '0.6rem' }}>الموظفون المحذوفون</h4>
                                {archivedEmployees.length === 0 ? (
                                    <div className="empty-state" style={{ marginBottom: '1.25rem' }}>لا يوجد موظفون في الأرشيف.</div>
                                ) : (
                                    <div className="table-container" style={{ maxHeight: 'none', marginBottom: '1.25rem' }}>
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>الاسم</th>
                                                    <th>الرقم الوظيفي</th>
                                                    <th style={{ textAlign: 'center' }}>الإجراءات</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {archivedEmployees.map((emp) => (
                                                    <tr key={emp.id}>
                                                        <td style={{ fontWeight: 600 }}>{emp.name}</td>
                                                        <td style={{ color: 'var(--text-muted)' }}>{emp.job_number || '-'}</td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <button
                                                                type="button"
                                                                className="btn btn-icon-text btn-outline"
                                                                onClick={() => handleRestoreEmployee(emp)}
                                                                disabled={restoringKey === `emp-${emp.id}`}
                                                            >
                                                                {restoringKey === `emp-${emp.id}` && <LoadingSpinner size={14} color="#10b981" style={{ marginLeft: 6 }} />}
                                                                <i className="fas fa-rotate-left"></i> استعادة
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                <h4 style={{ color: '#60a5fa', fontSize: '0.9rem', marginBottom: '0.6rem' }}>السنوات المالية المحذوفة</h4>
                                {archivedYears.length === 0 ? (
                                    <div className="empty-state">لا توجد سنوات مالية في الأرشيف.</div>
                                ) : (
                                    <div className="table-container" style={{ maxHeight: 'none' }}>
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>السنة المالية</th>
                                                    <th style={{ textAlign: 'center' }}>الإجراءات</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {archivedYears.map((year) => (
                                                    <tr key={year}>
                                                        <td style={{ fontWeight: 700, color: 'var(--emerald)' }}>سنة {year}</td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <button
                                                                type="button"
                                                                className="btn btn-icon-text btn-outline"
                                                                onClick={() => handleRestoreYear(year)}
                                                                disabled={restoringKey === `year-${year}`}
                                                            >
                                                                {restoringKey === `year-${year}` && <LoadingSpinner size={14} color="#10b981" style={{ marginLeft: 6 }} />}
                                                                <i className="fas fa-rotate-left"></i> استعادة
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>

            <div className="panel">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: archivesOpen ? '1.25rem' : 0 }}>
                    <h2 style={{ margin: 0 }}><i className="fas fa-box-archive"></i> الأرشيف المنفصل لكل سنة</h2>
                    <button type="button" className="btn btn-outline" onClick={toggleArchives}>
                        <i className={`fas fa-chevron-${archivesOpen ? 'up' : 'down'}`}></i> {archivesOpen ? 'إخفاء' : 'عرض'}
                    </button>
                </div>

                {archivesOpen && (
                    <>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                            عند الانتقال إلى سنة مالية جديدة، تُحفظ السنة السابقة تلقائياً في أرشيف منفصل خاص بها
                            (لقطة مجمّدة: الموظفون + أرصدة السنة + سجل الخصومات). كل سنة معزولة تماماً عن الأخرى،
                            وسجل الخصومات ينتقل معه للاستمرارية دون تغيير البيانات الحية.
                        </p>

                        {archivesError && <div className="form-error">{archivesError}</div>}

                        {archivesLoading ? (
                            <div className="empty-state">جاري تحميل الأرشيف المنفصل...</div>
                        ) : (
                            archives.length === 0 ? (
                                <div className="empty-state">لا توجد سنوات محفوظة في الأرشيف المنفصل بعد. أرشفة أي سنة تظهر في "إدارة السنوات المالية" أعلاه بزر "أرشفة منفصلة".</div>
                            ) : (
                                <div className="table-container" style={{ maxHeight: 'none' }}>
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>السنة</th>
                                                <th>تاريخ الأرشفة</th>
                                                <th>عدد الموظفين</th>
                                                <th style={{ textAlign: 'center' }}>الإجراءات</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {archives.map((a) => (
                                                <tr key={a.year}>
                                                    <td style={{ fontWeight: 700, color: 'var(--emerald)' }}>سنة {a.year}</td>
                                                    <td style={{ color: 'var(--text-muted)' }}>
                                                        {new Date(a.frozenAt).toLocaleString('ar-LY')}
                                                    </td>
                                                    <td>{a.employeesCount}</td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        <button
                                                            type="button"
                                                            className="btn btn-icon-text btn-outline"
                                                            onClick={() => handleExportYearArchive(a.year)}
                                                        >
                                                            <i className="fas fa-file-export"></i> تصدير JSON
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )
                        )}
                    </>
                )}
            </div>

            <div className="panel" style={{ borderColor: 'rgba(239, 68, 68, 0.35)' }}>
                <h2 style={{ color: 'var(--danger)' }}><i className="fas fa-skull-crossbones"></i> منطقة الخطر</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
                    سيؤدي هذا الإجراء إلى حذف جميع سجلات الموظفين وبياناتهم السنوية وسجل خصوماتهم نهائياً من النظام.
                    لا يمكن التراجع عن هذا الإجراء. يُنصح بأخذ نسخة تصدير قبل المتابعة.
                </p>
                <button className="btn btn-danger-outline" onClick={() => setShowDangerModal(true)}>
                    <i className="fas fa-trash-alt"></i> حذف كل السجلات
                </button>
            </div>

            {showDangerModal && (
                <ConfirmDangerModal
                    title="حذف كل السجلات"
                    message="سيتم حذف جميع سجلات الموظفين، بياناتهم السنوية، وسجل الخصومات بشكل نهائي ولا يمكن التراجع عن هذا الإجراء. لن يتم حذف المستخدمين أو السنوات المالية أو الإعدادات."
                    onClose={() => setShowDangerModal(false)}
                    onConfirm={handleDeleteAll}
                />
            )}
        </>
    );
}
