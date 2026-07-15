import { useRef, useState } from 'react';
import { useLeaveData } from '../hooks/useLeaveData';
import PageHeader from './PageHeader';
import ConfirmDangerModal from './modals/ConfirmDangerModal';
import { parseEmployeesExcel } from '../utils/parseEmployeesExcel';

export default function SettingsPage() {
    const {
        years, settings, loading, error, addYear, deleteYear, updateSettings,
        exportBackup, serverBackup, importBackup, deleteAllRecords, bulkAddEmployees,
    } = useLeaveData();

    const [dateValue, setDateValue] = useState('');
    const [dateError, setDateError] = useState('');
    const [dateSuccess, setDateSuccess] = useState('');
    const [savingDate, setSavingDate] = useState(false);


    const [newYear, setNewYear] = useState('');
    const [defaultAdded, setDefaultAdded] = useState(30);
    const [yearError, setYearError] = useState('');
    const [savingYear, setSavingYear] = useState(false);

    const [backupError, setBackupError] = useState('');
    const [backupSuccess, setBackupSuccess] = useState('');
    const [serverBackingUp, setServerBackingUp] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [showDangerModal, setShowDangerModal] = useState(false);
    const fileInputRef = useRef(null);

    const [excelError, setExcelError] = useState('');
    const [excelSuccess, setExcelSuccess] = useState('');
    const [importingExcel, setImportingExcel] = useState(false);
    const excelInputRef = useRef(null);

    const currentDate = dateValue || settings.openingBalanceDate || '';

    async function handleSaveDate(e) {
        e.preventDefault();
        setDateError('');
        setDateSuccess('');
        if (!currentDate) {
            setDateError('يرجى اختيار تاريخ صحيح');
            return;
        }
        setSavingDate(true);
        try {
            await updateSettings({ openingBalanceDate: currentDate });
            setDateSuccess('تم تحديث تاريخ قطع الرصيد التراكمي بنجاح.');
        } catch (err) {
            setDateError(err.message || 'تعذر تحديث التاريخ');
        } finally {
            setSavingDate(false);
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
        setSavingYear(true);
        try {
            await addYear({ year: yearStr, defaultAddedDays: Number(defaultAdded) || 0 });
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
        a.setAttribute('download', 'نسخة_تصدير_منظومة_الإجازات_' + new Date().toISOString().split('T')[0] + '.json');
        document.body.appendChild(a);
        a.click();
        a.remove();
        return data;
    }

    async function handleDeleteYear(year) {
        // Safety net: always take a fresh backup before a destructive year
        // deletion. If the backup itself fails, abort rather than risk
        // deleting data with no way to recover it.
        try {
            await downloadBackupFile();
        } catch (err) {
            alert(
                'تعذر إنشاء نسخة احتياطية تلقائية قبل الحذف، لذلك تم إلغاء العملية حفاظاً على سلامة البيانات.\n' +
                    (err.message || '')
            );
            return;
        }

        if (
            !window.confirm(
                'تنبيه: سيتم حذف كل الأيام المضافة والخصومات المرتبطة بهذه السنة نهائياً لجميع الموظفين. لحماية بياناتك، تم تنزيل نسخة احتياطية (JSON) تلقائياً للتو. هل أنت متأكد من الاستمرار في الحذف؟'
            )
        )
            return;

        try {
            await deleteYear(year);
        } catch (err) {
            alert(err.message || 'تعذر حذف السنة المالية');
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

    async function handleServerBackup() {
        setBackupError('');
        setBackupSuccess('');
        setServerBackingUp(true);
        try {
            const result = await serverBackup();
            setBackupSuccess(result.message || 'تم إنشاء نسخة احتياطية في الخادم بنجاح.');
        } catch (err) {
            setBackupError(err.message || 'تعذر إنشاء النسخة الاحتياطية في الخادم');
        } finally {
            setServerBackingUp(false);
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

        if (!Array.isArray(parsed.years) || !Array.isArray(parsed.employees)) {
            setBackupError('صيغة الملف غير صالحة: يجب أن يحتوي على years و employees.');
            return;
        }

        if (
            !window.confirm(
                'سيؤدي الاستيراد إلى حذف جميع بيانات الموظفين والسنوات المالية الحالية واستبدالها بالكامل ببيانات الملف المستورد.\nهل أنت متأكد من المتابعة؟'
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

    async function handleExcelFile(e) {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        setExcelError('');
        setExcelSuccess('');

        let rows;
        try {
            rows = await parseEmployeesExcel(file);
        } catch (err) {
            setExcelError(err.message || 'تعذر قراءة الملف');
            return;
        }

        if (
            !window.confirm(
                `تم العثور على ${rows.length} صف في الملف. سيتم إضافتهم كموظفين جدد بالإعدادات الافتراضية (يمكن تعديل بياناتهم لاحقاً).\nهل تريد المتابعة؟`
            )
        ) {
            return;
        }

        setImportingExcel(true);
        try {
            const result = await bulkAddEmployees(rows);
            const extras = [];
            if (result.skipped) extras.push(`تم تخطي ${result.skipped} صف بدون اسم`);
            if (result.reconciled) extras.push(`تمت تسوية جرد ورقي لـ ${result.reconciled} موظف`);
            setExcelSuccess(`تم استيراد ${result.created} موظف بنجاح${extras.length ? ` (${extras.join('، ')})` : ''}.`);
        } catch (err) {
            setExcelError(err.message || 'تعذر استيراد الملف');
        } finally {
            setImportingExcel(false);
        }
    }

    async function handleDeleteAll() {
        await deleteAllRecords();
        setBackupError('');
        setBackupSuccess('تم حذف جميع سجلات الموظفين بنجاح.');
    }

    return (
        <>
            <PageHeader />

            <div className="panel">
                <h2><i className="fas fa-calendar-day"></i> الرصيد التراكمي للسنوات السابقة</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
                    هذا التاريخ يحدد آخر نقطة تجميع للرصيد التراكمي، ويظهر بجانب "الرصيد التراكمي (للسنوات السابقة)"
                    في جدول الموظفين ونموذج إضافة/تعديل موظف.
                </p>
                {dateError && <div className="form-error">{dateError}</div>}
                {dateSuccess && (
                    <div
                        className="form-error"
                        style={{
                            background: 'rgba(16, 185, 129, 0.1)',
                            borderColor: 'rgba(16, 185, 129, 0.35)',
                            color: 'var(--emerald)',
                        }}
                    >
                        {dateSuccess}
                    </div>
                )}
                <form className="inline-form" onSubmit={handleSaveDate}>
                    <div className="form-group">
                        <label>تاريخ قطع الرصيد التراكمي للسنوات السابقة</label>
                        <input
                            type="date"
                            value={currentDate}
                            onChange={(e) => {
                                setDateValue(e.target.value);
                                setDateSuccess('');
                            }}
                        />
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={savingDate || loading}>
                        <i className="fas fa-save"></i> {savingDate ? 'جاري الحفظ...' : 'حفظ التاريخ'}
                    </button>
                </form>

                <div style={{ borderTop: '1px dashed var(--table-border)', margin: '1.5rem 0 1rem' }}></div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    <i className="fas fa-clock" style={{ color: '#60a5fa', marginLeft: 6 }}></i>
                    يعتمد النظام الآن على <b>الساعة والتاريخ الفعليين للجهاز</b> (يتقدّمان تلقائياً) كـ "تاريخ اليوم الحالي"
                    في جميع عمليات التحقق مثل قيد الأثر الرجعي (40 يوماً). يظهر التاريخ والوقت الحاليان أعلى الصفحة.
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
                            placeholder={String(new Date().getFullYear())}
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
                        <i className="fas fa-plus"></i> {savingYear ? 'جاري الإضافة...' : 'إضافة سنة'}
                    </button>
                </form>

                {error && <div className="form-error">{error}</div>}

                {loading ? (
                    <div className="empty-state">جاري التحميل...</div>
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
                                                className="btn btn-danger-outline"
                                                style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
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
                <h2><i className="fas fa-file-excel"></i> استيراد موظفين بالجملة</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
                    ارفع ملف Excel أو CSV يحتوي على الأعمدة التالية بالضبط في الصف الأول: <code>name</code>،{' '}
                    <code>national_id</code>، <code>job_title</code>. سيتم إدراج كل صف كموظف جديد بالأرصدة
                    الافتراضية، ويمكن تعديل بياناته لاحقاً من صفحة الموظفين.
                    <br />
                    يمكن أيضاً إضافة عمود اختياري باسم <code style={{ direction: 'rtl' }}>الرقم الوظيفي</code>{' '}
                    لتعبئة الرقم الوظيفي لكل موظف تلقائياً.
                    <br />
                    وعمود اختياري آخر باسم <code style={{ direction: 'rtl' }}>الرصيد المتبقي</code>{' '}
                    — إن وُجد رقم في هذا العمود لأي موظف، سيقوم النظام تلقائياً بتسجيل الفرق كخصم
                    "تسوية جرد ورقي" في سجل خصوماته.
                </p>
                {excelError && <div className="form-error">{excelError}</div>}
                {excelSuccess && (
                    <div
                        className="form-error"
                        style={{
                            background: 'rgba(16, 185, 129, 0.1)',
                            borderColor: 'rgba(16, 185, 129, 0.35)',
                            color: 'var(--emerald)',
                        }}
                    >
                        {excelSuccess}
                    </div>
                )}
                <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => excelInputRef.current?.click()}
                    disabled={importingExcel}
                >
                    <i className="fas fa-file-excel"></i> {importingExcel ? 'جاري الاستيراد...' : 'استيراد موظفين من Excel'}
                </button>
                <input
                    ref={excelInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: 'none' }}
                    onChange={handleExcelFile}
                />
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
                        <i className="fas fa-file-export"></i> {exporting ? 'جاري التصدير...' : 'حفظ نسخة تصدير'}
                    </button>
                    <button className="btn btn-outline" onClick={handleServerBackup} disabled={serverBackingUp}>
                        <i className="fas fa-server"></i> {serverBackingUp ? 'جاري الحفظ...' : 'إنشاء نسخة احتياطية في الخادم'}
                    </button>
                    <button
                        type="button"
                        className="btn btn-warning-outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={importing}
                    >
                        <i className="fas fa-file-import"></i> {importing ? 'جاري الاستيراد...' : 'استيراد نسخة'}
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,application/json"
                        style={{ display: 'none' }}
                        onChange={handleImportFile}
                    />
                </div>
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
