import { useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';

// Global freeze modal: pick an employee, see their current status, then
// confirm freezing/unfreezing their record. Admin-only (gated by caller).
export default function FreezeModal({ employees, onToggleFreeze, onClose }) {
    const [selectedId, setSelectedId] = useState('');
    const [includeInPrint, setIncludeInPrint] = useState(true);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const employee = employees.find((e) => e.id === Number(selectedId)) || null;

    async function handleConfirm() {
        if (!employee) {
            setError('يرجى اختيار الموظف أولاً');
            return;
        }
        setSaving(true);
        try {
            await onToggleFreeze(employee.id, includeInPrint);
            onClose();
        } catch (err) {
            setError(err.message || 'تعذر تنفيذ العملية');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal active">
            <div className="modal-content" style={{ maxWidth: 520 }}>
                <div className="modal-header">
                    <h3 className="modal-title"><i className="fas fa-snowflake"></i> تجميد / إلغاء تجميد سجل موظف</h3>
                    <button className="close-modal" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="form-error">{error}</div>}

                <div className="form-group">
                    <label>اختر الموظف</label>
                    <select
                        value={selectedId}
                        onChange={(e) => { setSelectedId(e.target.value); setError(''); }}
                    >
                        <option value="">-- اختر الموظف --</option>
                        {employees.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                                {emp.name}{emp.job_number ? ` — ${emp.job_number}` : ''}
                                {emp.is_frozen ? ' (مُجمّد)' : ''}
                            </option>
                        ))}
                    </select>
                </div>

                {employee && (
                    <div
                        style={{
                            background: employee.is_frozen ? 'rgba(96,165,250,0.08)' : 'rgba(239,68,68,0.08)',
                            border: `1px dashed ${employee.is_frozen ? 'rgba(96,165,250,0.5)' : 'rgba(239,68,68,0.5)'}`,
                            borderRadius: 8,
                            padding: '0.9rem 1rem',
                            margin: '0.25rem 0 1rem',
                            fontSize: '0.92rem',
                            lineHeight: 1.9,
                        }}
                    >
                        {employee.is_frozen ? (
                            <span>
                                هذا الموظف <b style={{ color: '#60a5fa' }}>مُجمّد</b> حالياً. سيؤدي التأكيد إلى{' '}
                                <b>إلغاء التجميد</b> وإعادته إلى القائمة النشطة.
                            </span>
                        ) : (
                            <>
                                <span>
                                    سيتم <b style={{ color: '#ef4444' }}>تجميد</b> سجل الموظف{' '}
                                    <b>{employee.name}</b>، وسيُنقل إلى أسفل القائمة مع شارة "مُجمّد". لا تُحذف أي بيانات ويمكن التراجع.
                                </span>
                                <div className="checkbox-group" style={{ marginTop: '0.8rem' }}>
                                    <input
                                        type="checkbox"
                                        id="includeInPrint"
                                        checked={includeInPrint}
                                        onChange={(e) => setIncludeInPrint(e.target.checked)}
                                    />
                                    <label htmlFor="includeInPrint">إظهار الموظف في تقارير الطباعة</label>
                                </div>
                            </>
                        )}
                    </div>
                )}

                <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: '100%', justifyContent: 'center' }}
                    disabled={!employee || saving}
                    onClick={handleConfirm}
                >
                    {saving && <LoadingSpinner size={16} color="#fff" style={{ marginLeft: 8 }} />}
                    {saving
                        ? 'جاري التنفيذ...'
                        : employee && employee.is_frozen
                            ? 'تأكيد إلغاء التجميد'
                            : 'تأكيد التجميد'}
                </button>
            </div>
        </div>
    );
}
