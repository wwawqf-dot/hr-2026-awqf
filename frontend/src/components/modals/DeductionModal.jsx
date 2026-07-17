import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { calculateDeductionDays } from '../../utils/deductionDays';
import { getLibyaDateStr, getAccrualLabel, getAccruedDays } from '../../utils/libyaTime';
import { computeFifoAudit } from '../../utils/leaveCalc';
import CustomConfirmModal from './CustomConfirmModal';

const RETRO_LIMIT_DAYS = 40;

function parseLocalDate(str) {
    if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
    const [y, m, d] = str.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function localTodayStr() {
    return getLibyaDateStr();
}

function daysBetween(fromStr, toStr) {
    const from = parseLocalDate(fromStr);
    const to = parseLocalDate(toStr);
    if (!from || !to) return null;
    return Math.round((to - from) / 86400000);
}

function computeNetBalance(employee, monthlyRate) {
    if (employee.is_unpaid_leave) return 0;
    const currentYear = String(new Intl.DateTimeFormat('en', { timeZone: 'Africa/Tripoli', year: 'numeric' }).format(new Date()));
    const initial = parseFloat(employee.initial_carried_forward) || 0;
    const yearsData = employee.years_data || {};
    let balance = initial;
    for (const [year, yd] of Object.entries(yearsData)) {
        balance += (parseFloat(yd?.added) || 0) - (parseFloat(yd?.deducted) || 0);
    }
    // Add dynamic accrual for current year if not yet stored in DB
    if (!yearsData[currentYear]) {
        balance += getAccruedDays(Number(currentYear), monthlyRate, employee.hire_date_current_year);
    }
    return balance;
}

export default function DeductionModal({ employee, onClose, onSubmit, onDeleteDeduction }) {
    const { isAdmin } = useAuth();
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');
    const [holidays, setHolidays] = useState(0);
    const [unknownDays, setUnknownDays] = useState('');
    const [note, setNote] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const years = Object.keys(employee.years_data || {}).sort();
    const monthlyRate = employee.over_45 ? 3.75 : 2.5;
    const fifo = useMemo(() => computeFifoAudit(employee, years, monthlyRate), [employee, years, monthlyRate]);

    useEffect(() => {
        setStart(''); setEnd(''); setHolidays(0);
        setUnknownDays(''); setNote(''); setError('');
    }, [employee.id]);

    const isMemorizer = employee.is_memorizer === true;
    const hasUnknownDays = unknownDays !== '' && Number(unknownDays) > 0;
    const hasDates = Boolean(start || end);
    const days = hasUnknownDays ? Number(unknownDays) : calculateDeductionDays(start, end, holidays, isMemorizer);

    const netBalance = computeNetBalance(employee, monthlyRate);
    const retroDaysLive = !hasUnknownDays && start ? daysBetween(start, localTodayStr()) : null;
    const retroBlocked = retroDaysLive !== null && retroDaysLive > RETRO_LIMIT_DAYS;
    const balanceBlocked = days > 0 && days > netBalance;

    // FIFO split preview for this deduction
    const fifoPreview = useMemo(() => {
        if (days <= 0) return null;
        const fromPrev = Math.min(fifo.previousCarryOver, days);
        const fromCurrent = days - fromPrev;
        return { fromPrev, fromCurrent };
    }, [days, fifo.previousCarryOver]);

    const liveBlockMessage = balanceBlocked
        ? `الرصيد المتاح (${netBalance} يوم) غير كافٍ لتغطية الخصم المطلوب (${days} يوم).`
        : retroBlocked
            ? `تاريخ البداية يسبق اليوم بـ ${retroDaysLive} يوماً، والحد الأقصى المسموح ${RETRO_LIMIT_DAYS} يوماً.`
            : '';

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');

        if (days <= 0) {
            setError('يجب تحديد تاريخ البداية والنهاية، أو إدخال عدد أيام في حقل الخصم بغير تاريخ');
            return;
        }

        if (!hasUnknownDays && start) {
            const retroDays = daysBetween(start, localTodayStr());
            if (retroDays !== null && retroDays > RETRO_LIMIT_DAYS) {
                setError('لا يمكن تسجيل إجازة بتاريخ رجعي يتجاوز 40 يوماً من تاريخ النظام الحالي.');
                return;
            }
        }

        if (days > computeNetBalance(employee, monthlyRate)) {
            setError('فشلت العملية: رصيد الموظف الحالي غير كافٍ لتغطية عدد أيام الخصم المطلوبة.');
            return;
        }

        setSaving(true);
        try {
            const noteVal = note.trim() || undefined;
            if (hasUnknownDays) {
                await onSubmit(employee.id, { unknownDays: Number(unknownDays), note: noteVal });
            } else {
                await onSubmit(employee.id, { start, end, customHolidays: Number(holidays) || 0, note: noteVal });
            }
            setStart(''); setEnd(''); setHolidays(0);
            setUnknownDays(''); setNote('');
        } catch (err) {
            setError(err.message || 'حدث خطأ أثناء تسجيل الخصم');
        } finally {
            setSaving(false);
        }
    }

    async function confirmDeleteHistoryItem() {
        setDeleting(true);
        try {
            await onDeleteDeduction(employee.id, pendingDeleteId);
            setPendingDeleteId(null);
        } catch (err) {
            setPendingDeleteId(null);
            setError(err.message || 'تعذر حذف الخصم');
        } finally {
            setDeleting(false);
        }
    }

    const history = [...(employee.deductions_history || [])].reverse();

    return (
        <div className="modal active">
            <div className="modal-content" style={{ maxWidth: 650 }}>
                <div className="modal-header">
                    <h3 className="modal-title">تسجيل خصم إجازة</h3>
                    <button className="close-modal" onClick={onClose}>&times;</button>
                </div>
                <p style={{ marginBottom: '0.8rem', color: '#60a5fa', fontWeight: 'bold', fontSize: '1.05rem' }}>
                    {employee.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.88rem' }}>({employee.job_number || '-'})</span>
                </p>

                <div className="fifo-stats-grid">
                    <div className="fifo-stat-card">
                        <span className="fifo-stat-label">الرصيد المرحّل</span>
                        <span className="fifo-stat-val blue">{fifo.previousCarryOver}</span>
                    </div>
                    <div className="fifo-stat-card">
                        <span className="fifo-stat-label">مستهلك من السابقة</span>
                        <span className="fifo-stat-val orange">{fifo.consumedFromPrev}</span>
                    </div>
                    <div className="fifo-stat-card">
                        <span className="fifo-stat-label">مستهلك من الحالية</span>
                        <span className="fifo-stat-val red">{fifo.consumedFromCurrent}</span>
                    </div>
                    <div className="fifo-stat-card">
                        <span className="fifo-stat-label">الصافي القانوني</span>
                        <span className="fifo-stat-val green">{fifo.legalNet}</span>
                    </div>
                </div>

                {error && <div className="form-error">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="date-range-row">
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>من تاريخ</label>
                            <input type="date" value={start} disabled={hasUnknownDays} onChange={(e) => setStart(e.target.value)} />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>إلى تاريخ</label>
                            <input type="date" value={end} disabled={hasUnknownDays} onChange={(e) => setEnd(e.target.value)} />
                        </div>
                    </div>
                    <div className="form-group">
                        <label>عطلات رسمية تقع في هذه الفترة لاستبعادها (أيام)</label>
                        <input type="number" min="0" value={holidays} disabled={hasUnknownDays} onChange={(e) => setHolidays(e.target.value)} />
                    </div>
                    <div className="calculated-days">
                        <div>
                            <div style={{ fontSize: '0.95rem', fontWeight: 'bold' }}>صافي الخصم المحتسب:</div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                {hasUnknownDays ? '(عدد أيام مُدخل يدوياً بدون تاريخ)' : `(تلقائياً بدون ${isMemorizer ? 'الجمعة والسبت' : 'الخميس والجمعة'} والمستبعدة)`}
                            </div>
                        </div>
                        <span>{days || 0}</span>
                    </div>

                    {/* FIFO split preview */}
                    {fifoPreview && days > 0 && days <= netBalance && (
                        <div className="fifo-split-preview">
                            <div className="fifo-split-item">
                                <span className="fifo-split-label">يُخصم من الرصيد المرحّل:</span>
                                <span className="fifo-split-value">{fifoPreview.fromPrev} يوم</span>
                            </div>
                            <div className="fifo-split-item">
                                <span className="fifo-split-label">يُخصم من رصيد السنة الحالية ({getAccrualLabel()}):</span>
                                <span className="fifo-split-value">{fifoPreview.fromCurrent} يوم</span>
                            </div>
                        </div>
                    )}

                    <div className="form-group">
                        <label>البيان / ملاحظات الخصم</label>
                        <input type="text" placeholder="اختياري - مثال: إجازة مرضية، إجازة طارئة..." value={note} onChange={(e) => setNote(e.target.value)} />
                    </div>

                    {liveBlockMessage && (
                        <div className="form-error" style={{ marginBottom: '0.9rem' }}>
                            <i className="fas fa-ban" style={{ marginLeft: 6 }}></i>
                            {liveBlockMessage}
                        </div>
                    )}

                    <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
                        disabled={saving || balanceBlocked || retroBlocked}>
                        {saving ? 'جاري الحفظ...' : 'اعتماد الخصم'}
                    </button>
                </form>

                <div className="history-section">
                    <h4 style={{ marginBottom: '0.75rem' }}><i className="fas fa-history"></i> سجل الخصومات للموظف</h4>
                    {history.length === 0 ? (
                        <div className="no-history">لا توجد خصومات إجازة مسجلة مسبقاً.</div>
                    ) : (
                        <table className="history-table">
                            <thead>
                                <tr>
                                    <th>السنة</th>
                                    <th>من تاريخ</th>
                                    <th>إلى تاريخ</th>
                                    <th>الأيام المخصومة</th>
                                    <th>الملاحظات</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map((item) => {
                                    const isUnknownDate = !item.start;
                                    return (
                                        <tr key={item.id}>
                                            <td style={{ textAlign: 'center', fontWeight: 'bold', color: '#f59e0b' }}>{item.year}</td>
                                            {isUnknownDate ? (
                                                <td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>خصم بغير تاريخ</td>
                                            ) : (
                                                <>
                                                    <td style={{ textAlign: 'center' }}>{item.start}</td>
                                                    <td style={{ textAlign: 'center' }}>{item.end}</td>
                                                </>
                                            )}
                                            <td style={{ textAlign: 'center', color: 'var(--danger)', fontWeight: 'bold' }}>
                                                {item.days} أيام
                                                {item.deductionSource && (
                                                    <span style={{ fontSize: '0.65rem', fontWeight: 400, color: 'var(--text-muted)', marginRight: 4 }}>{item.deductionSource}</span>
                                                )}
                                            </td>
                                            <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>{item.note || '—'}</td>
                                            <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                {isAdmin && (
                                                    <button type="button" className="btn btn-danger-outline" style={{ padding: '0.25rem 0.45rem', fontSize: '0.72rem' }}
                                                        onClick={() => setPendingDeleteId(item.id)} title="حذف الخصم">
                                                        <i className="fas fa-trash"></i>
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {pendingDeleteId !== null && (
                <CustomConfirmModal
                    title="حذف خصم من السجل"
                    message="هل أنت متأكد من حذف هذا الخصم من السجل؟ سيتم إعادة الأيام إلى رصيد الموظف. لا يمكن التراجع عن هذا الإجراء."
                    confirmLabel="نعم، متأكد" cancelLabel="إلغاء" busy={deleting}
                    onConfirm={confirmDeleteHistoryItem} onCancel={() => setPendingDeleteId(null)}
                />
            )}
        </div>
    );
}
