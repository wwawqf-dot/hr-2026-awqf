import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { calculateDeductionDays } from '../../utils/deductionDays';
import { getLibyaDateStr } from '../../utils/libyaTime';
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

// Current net cumulative balance = initial carried-forward + Σ(added - deducted).
function computeNetBalance(employee) {
    const initial = parseFloat(employee.initial_carried_forward) || 0;
    return Object.values(employee.years_data || {}).reduce(
        (acc, yd) => acc + (parseFloat(yd?.added) || 0) - (parseFloat(yd?.deducted) || 0),
        initial
    );
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

    useEffect(() => {
        setStart('');
        setEnd('');
        setHolidays(0);
        setUnknownDays('');
        setNote('');
        setError('');
    }, [employee.id]);

    const isHafiz = employee.job_title === 'محفظ' || employee.job_title === 'محفظة';
    const hasUnknownDays = unknownDays !== '' && Number(unknownDays) > 0;
    const hasDates = Boolean(start || end);
    const days = hasUnknownDays ? Number(unknownDays) : calculateDeductionDays(start, end, holidays, employee.job_title);

    // Live validation, recomputed on every keystroke, so the submit button
    // disables BEFORE the user tries to save. The submit-time checks below
    // (and the un-bypassable server-side checks) remain as backstops.
    const netBalance = computeNetBalance(employee);
    const retroDaysLive = !hasUnknownDays && start ? daysBetween(start, localTodayStr()) : null;
    const retroBlocked = retroDaysLive !== null && retroDaysLive > RETRO_LIMIT_DAYS;
    const balanceBlocked = days > 0 && days > netBalance;
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

        // 40-day retroactive limit — dated deductions only, measured against the
        // real auto-advancing clock. The "unknown dates" path bypasses this.
        if (!hasUnknownDays && start) {
            const retroDays = daysBetween(start, localTodayStr());
            if (retroDays !== null && retroDays > RETRO_LIMIT_DAYS) {
                setError('لا يمكن تسجيل إجازة بتاريخ رجعي يتجاوز 40 يوماً من تاريخ النظام الحالي.');
                return;
            }
        }

        // Insufficient-balance protection — applies to both paths.
        if (days > computeNetBalance(employee)) {
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
            setStart('');
            setEnd('');
            setHolidays(0);
            setUnknownDays('');
            setNote('');
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
                <p style={{ marginBottom: '1.2rem', color: '#60a5fa', fontWeight: 'bold', fontSize: '1.1rem' }}>
                    الموظف: {employee.name}
                </p>

                {error && <div className="form-error">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>من تاريخ</label>
                            <input
                                type="date"
                                value={start}
                                disabled={hasUnknownDays}
                                onChange={(e) => setStart(e.target.value)}
                            />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>إلى تاريخ</label>
                            <input
                                type="date"
                                value={end}
                                disabled={hasUnknownDays}
                                onChange={(e) => setEnd(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="form-group">
                        <label>عطلات رسمية تقع في هذه الفترة لاستبعادها (أيام)</label>
                        <input
                            type="number"
                            min="0"
                            value={holidays}
                            disabled={hasUnknownDays}
                            onChange={(e) => setHolidays(e.target.value)}
                        />
                    </div>
                    <div className="calculated-days">
                        <div>
                            <div style={{ fontSize: '0.95rem', fontWeight: 'bold' }}>صافي الخصم المحتسب:</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                {hasUnknownDays
                                    ? '(عدد أيام مُدخل يدوياً بدون تاريخ)'
                                    : `(تلقائياً بدون ${isHafiz ? 'الخميس والجمعة' : 'الجمعة والسبت'} والمستبعدة)`}
                            </div>
                        </div>
                        <span>{days || 0}</span>
                    </div>

                    <div
                        style={{
                            background: 'rgba(96, 165, 250, 0.05)',
                            padding: '0.9rem 1rem',
                            borderRadius: 8,
                            border: '1px dashed rgba(96, 165, 250, 0.35)',
                            marginBottom: '1.25rem',
                        }}
                    >
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#60a5fa', fontWeight: 600 }}>
                            خصم إجازات غير معروفة التواريخ
                        </label>
                        <input
                            type="number"
                            min="1"
                            step="1"
                            placeholder="عدد الأيام (بدلاً من تحديد التواريخ أعلاه)"
                            value={unknownDays}
                            disabled={hasDates}
                            onChange={(e) => setUnknownDays(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label>البيان / ملاحظات الخصم</label>
                        <input
                            type="text"
                            placeholder="اختياري - مثال: إجازة مرضية، إجازة طارئة..."
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                        />
                    </div>

                    {liveBlockMessage && (
                        <div className="form-error" style={{ marginBottom: '0.9rem' }}>
                            <i className="fas fa-ban" style={{ marginLeft: 6 }}></i>
                            {liveBlockMessage}
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%', justifyContent: 'center' }}
                        disabled={saving || balanceBlocked || retroBlocked}
                    >
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
                                            <td style={{ textAlign: 'center', fontWeight: 'bold', color: '#f59e0b' }}>
                                                {item.year}
                                            </td>
                                            {isUnknownDate ? (
                                                <td
                                                    colSpan={2}
                                                    style={{ textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}
                                                >
                                                    خصم بغير تاريخ
                                                </td>
                                            ) : (
                                                <>
                                                    <td style={{ textAlign: 'center' }}>{item.start}</td>
                                                    <td style={{ textAlign: 'center' }}>{item.end}</td>
                                                </>
                                            )}
                                            <td style={{ textAlign: 'center', color: 'var(--danger)', fontWeight: 'bold' }}>
                                                {item.days} أيام
                                            </td>
                                            <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                                                {item.note || '—'}
                                            </td>
                                            <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                {isAdmin && (
                                                    <button
                                                        type="button"
                                                        className="btn btn-danger-outline"
                                                        style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem' }}
                                                        onClick={() => setPendingDeleteId(item.id)}
                                                        title="حذف الخصم"
                                                    >
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
                    confirmLabel="نعم، متأكد"
                    cancelLabel="إلغاء"
                    busy={deleting}
                    onConfirm={confirmDeleteHistoryItem}
                    onCancel={() => setPendingDeleteId(null)}
                />
            )}
        </div>
    );
}
