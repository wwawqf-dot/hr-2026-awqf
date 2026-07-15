import { useState } from 'react';
import { printClearanceLetter } from '../../utils/printClearanceLetter';

// Pro-rata clearance math for an employee leaving mid-year (transfer or
// resignation). They FORFEIT the full default annual allocation (the 30/45
// days granted at year start); it is intentionally NOT part of this formula.
// Instead they earn only 2.5 days per worked month, rounded UP.
//   M              = month integer of the end-of-service date (May => 5)
//   earnedThisYear = Math.ceil(M * 2.5)                 (5 * 2.5 = 12.5 => 13)
//   consumedThisYear = total deductions recorded in the end-of-service year
//   finalBalance   = pastCumulative + earnedThisYear - consumedThisYear
// NOTE: `years_data[year].added` (the 30/45) is deliberately never read here.
export function computeClearance(employee, endServiceDate) {
    const [yearStr, monthStr] = String(endServiceDate || '').split('-');
    const month = Number(monthStr);
    const pastCumulative = Number(employee.initial_carried_forward) || 0;
    const earnedCurrentYear = Number.isFinite(month) && month > 0 ? Math.ceil(month * 2.5) : 0;
    const deductedCurrentYear = Number(employee.years_data?.[yearStr]?.deducted) || 0;
    const finalBalance = pastCumulative + earnedCurrentYear - deductedCurrentYear;
    return { month, pastCumulative, earnedCurrentYear, deductedCurrentYear, finalBalance };
}

export default function ClearanceModal({ employees, onClose }) {
    const [selectedId, setSelectedId] = useState('');
    const [destination, setDestination] = useState('');
    const [endServiceDate, setEndServiceDate] = useState('');
    const [error, setError] = useState('');

    const employee = employees.find((e) => e.id === Number(selectedId)) || null;
    const preview = employee && endServiceDate ? computeClearance(employee, endServiceDate) : null;

    function handleSubmit(e) {
        e.preventDefault();
        setError('');
        if (!employee) {
            setError('يرجى اختيار الموظف أولاً');
            return;
        }
        if (!destination.trim()) {
            setError('يرجى إدخال الجهة المُحال إليها');
            return;
        }
        if (!endServiceDate) {
            setError('يرجى تحديد تاريخ الانقطاع عن العمل');
            return;
        }
        const { finalBalance } = computeClearance(employee, endServiceDate);
        printClearanceLetter(employee, { destination: destination.trim(), endServiceDate, finalBalance });
        onClose();
    }

    return (
        <div className="modal active">
            <div className="modal-content" style={{ maxWidth: 560 }}>
                <div className="modal-header">
                    <h3 className="modal-title"><i className="fas fa-file-export"></i> إخلاء طرف / تصفية رصيد موظف</h3>
                    <button className="close-modal" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="form-error">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>اختر الموظف</label>
                        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                            <option value="">-- اختر الموظف --</option>
                            {employees.map((emp) => (
                                <option key={emp.id} value={emp.id}>
                                    {emp.name}{emp.job_number ? ` — ${emp.job_number}` : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    {employee && (
                        <>
                            <div className="form-group">
                                <label>الجهة المُحال إليها / المرسل إليها</label>
                                <input
                                    type="text"
                                    value={destination}
                                    onChange={(e) => setDestination(e.target.value)}
                                    placeholder="مثال: إدارة أوقاف طرابلس"
                                />
                            </div>
                            <div className="form-group">
                                <label>تاريخ الانقطاع عن العمل</label>
                                <input
                                    type="date"
                                    value={endServiceDate}
                                    onChange={(e) => setEndServiceDate(e.target.value)}
                                />
                            </div>

                            {preview && (
                                <div
                                    style={{
                                        background: 'rgba(16, 185, 129, 0.06)',
                                        border: '1px dashed rgba(16, 185, 129, 0.4)',
                                        borderRadius: 8,
                                        padding: '0.9rem 1rem',
                                        margin: '0.5rem 0 1rem',
                                        fontSize: '0.9rem',
                                        lineHeight: 1.9,
                                    }}
                                >
                                    <div>الرصيد التراكمي السابق: <b>{preview.pastCumulative}</b></div>
                                    <div>
                                        المستحق للسنة الحالية (عن {preview.month} أشهر × 2.5، مقرّب لأعلى):{' '}
                                        <b>{preview.earnedCurrentYear}</b>
                                    </div>
                                    <div>المخصوم خلال السنة الحالية: <b>{preview.deductedCurrentYear}</b></div>
                                    <div style={{ marginTop: '0.4rem', color: '#34d399', fontWeight: 800, fontSize: '1.05rem' }}>
                                        الرصيد النهائي المستحق: {preview.finalBalance} يوماً
                                    </div>
                                </div>
                            )}

                            <button
                                type="submit"
                                className="btn btn-primary"
                                style={{ width: '100%', justifyContent: 'center' }}
                            >
                                اعتماد وطباعة إخلاء الطرف <i className="fas fa-print"></i>
                            </button>
                        </>
                    )}
                </form>
            </div>
        </div>
    );
}
