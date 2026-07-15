import { useEffect, useState } from 'react';
import { formatDateDisplay } from '../../utils/formatDate';

const emptyForm = { name: '', job_number: '', national_id: '', job_title: '', initial_carried_forward: 0, over_45: false };

const JOB_TITLES = ['إداري', 'محفظ', 'محفظة', 'موجه', 'مشرفة', 'مشرف', 'متابع', 'خطيب'];

export default function EmployeeFormModal({ mode, employee, years, openingBalanceDate, onClose, onSubmit }) {
    const [form, setForm] = useState(emptyForm);
    const [yearsAdded, setYearsAdded] = useState({});
    const [actualRemainingBalance, setActualRemainingBalance] = useState('');
    const [reconciliationNote, setReconciliationNote] = useState('تسوية جرد ورقي');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (mode === 'edit' && employee) {
            setForm({
                name: employee.name,
                job_number: employee.job_number || '',
                national_id: employee.national_id || '',
                job_title: employee.job_title || '',
                initial_carried_forward: employee.initial_carried_forward || 0,
                over_45: employee.over_45 || false,
            });
            const initial = {};
            years.forEach((y) => {
                const existing = employee.years_data?.[y]?.added;
                initial[y] = existing !== undefined ? existing : employee.over_45 ? 45 : 30;
            });
            setYearsAdded(initial);
        } else {
            setForm(emptyForm);
            const initial = {};
            years.forEach((y) => { initial[y] = 30; });
            setYearsAdded(initial);
        }
        setActualRemainingBalance('');
        setReconciliationNote('تسوية جرد ورقي');
        setError('');
    }, [mode, employee, years]);

    function handleOver45Toggle(checked) {
        setForm((f) => ({ ...f, over_45: checked }));
        const next = {};
        years.forEach((y) => { next[y] = checked ? 45 : 30; });
        setYearsAdded(next);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        if (!form.name.trim()) {
            setError('يرجى إدخال اسم الموظف كاملاً');
            return;
        }
        setSaving(true);
        try {
            const years_data = {};
            years.forEach((y) => {
                years_data[y] = { added: Number(yearsAdded[y]) || 0 };
            });
            const payload = {
                name: form.name.trim(),
                job_number: form.job_number.trim(),
                national_id: form.national_id.trim(),
                job_title: form.job_title.trim(),
                initial_carried_forward: Number(form.initial_carried_forward) || 0,
                over_45: form.over_45,
                years_data,
            };
            if (actualRemainingBalance !== '') {
                payload.actualRemainingBalance = Number(actualRemainingBalance);
                payload.reconciliationNote = reconciliationNote;
            }
            await onSubmit(payload);
            onClose();
        } catch (err) {
            setError(err.message || 'حدث خطأ أثناء الحفظ');
        } finally {
            setSaving(false);
        }
    }

    const title = mode === 'edit' ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد';
    const submitLabel = mode === 'edit' ? 'حفظ التعديلات' : 'اعتماد وإدراج الموظف';

    return (
        <div className="modal active">
            <div className="modal-content">
                <div className="modal-header">
                    <h3 className="modal-title">{title}</h3>
                    <button className="close-modal" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="form-error">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>الرقم الوظيفي</label>
                        <input
                            type="text"
                            value={form.job_number}
                            onChange={(e) => setForm((f) => ({ ...f, job_number: e.target.value }))}
                            placeholder="أدخل الرقم الوظيفي"
                        />
                    </div>
                    <div className="form-group">
                        <label>اسم الموظف الكامل</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            placeholder="أدخل الاسم الرباعي"
                        />
                    </div>
                    <div className="form-group">
                        <label>الرقم الوطني</label>
                        <input
                            type="text"
                            value={form.national_id}
                            onChange={(e) => setForm((f) => ({ ...f, national_id: e.target.value }))}
                            placeholder="الرقم الوطني"
                        />
                    </div>
                    <div className="form-group">
                        <label>الصفة الوظيفية</label>
                        <select
                            value={form.job_title}
                            onChange={(e) => setForm((f) => ({ ...f, job_title: e.target.value }))}
                        >
                            <option value="">-- اختر الصفة الوظيفية --</option>
                            {JOB_TITLES.map((title) => (
                                <option key={title} value={title}>{title}</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label style={{ color: '#60a5fa', fontWeight: 'bold' }}>
                            الرصيد التراكمي (للسنوات السابقة)
                            <br />
                            <span style={{ fontWeight: 'normal', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                (حتى تاريخ {formatDateDisplay(openingBalanceDate)})
                            </span>
                        </label>
                        <input
                            type="number"
                            value={form.initial_carried_forward}
                            onChange={(e) => setForm((f) => ({ ...f, initial_carried_forward: e.target.value }))}
                        />
                    </div>
                    <div className="checkbox-group">
                        <input
                            type="checkbox"
                            id={`over45-${mode}`}
                            checked={form.over_45}
                            onChange={(e) => handleOver45Toggle(e.target.checked)}
                        />
                        <label htmlFor={`over45-${mode}`}>عمر الموظف فوق 50 سنة أو تجاوز 20 سنة من العمل (45 يوماً بدلاً من 30)</label>
                    </div>
                    <div style={{ borderTop: '1px dashed var(--table-border)', paddingTop: '1rem' }}>
                        <h4 style={{ color: '#60a5fa', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                            {mode === 'edit' ? 'تعديل مضاف الإجازة لكل سنة نشطة:' : 'تحديد مضاف الإجازة لكل سنة نشطة:'}
                        </h4>
                        {years.map((y) => (
                            <div
                                className="form-group"
                                key={y}
                                style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.6rem' }}
                            >
                                <label style={{ width: 140, marginBottom: 0 }}>مضاف سنة {y}:</label>
                                <input
                                    type="number"
                                    style={{ flex: 1 }}
                                    value={yearsAdded[y] ?? ''}
                                    onChange={(e) => setYearsAdded((prev) => ({ ...prev, [y]: e.target.value }))}
                                />
                            </div>
                        ))}
                    </div>

                    <div
                        style={{
                            background: 'rgba(96, 165, 250, 0.05)',
                            padding: '0.9rem 1rem',
                            borderRadius: 8,
                            border: '1px dashed rgba(96, 165, 250, 0.35)',
                            marginTop: '1rem',
                            marginBottom: '0.5rem',
                        }}
                    >
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#60a5fa', fontWeight: 600 }}>
                            {mode === 'edit'
                                ? 'الرصيد المتبقي الفعلي في الدفاتر لتسوية الحساب'
                                : 'الرصيد المتبقي الفعلي في الدفاتر (تسوية جرد ورقي)'}
                        </label>
                        <input
                            type="number"
                            placeholder={
                                mode === 'edit'
                                    ? 'اتركه فارغاً إذا كنت لا ترغب بتسوية الرصيد الآن'
                                    : 'اتركه فارغاً إذا كان هذا موظف جديد بدون سجلات سابقة'
                            }
                            value={actualRemainingBalance}
                            onChange={(e) => setActualRemainingBalance(e.target.value)}
                        />
                        <label style={{ display: 'block', margin: '0.75rem 0 0.4rem', color: '#60a5fa', fontWeight: 600 }}>
                            بيان التسوية
                        </label>
                        <input
                            type="text"
                            value={reconciliationNote}
                            onChange={(e) => setReconciliationNote(e.target.value)}
                            placeholder="بيان التسوية"
                        />
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                            {mode === 'edit'
                                ? 'إذا أدخلت رقماً هنا، سيقارنه النظام بالصافي التراكمي الحالي للموظف، ويسجل الفرق تلقائياً كخصم "تسوية جرد ورقي بعد التعديل" لإجبار الرصيد على مطابقة هذا الرقم بالضبط.'
                                : 'إذا كان لدى الموظف رصيد فعلي مسجل في الدفاتر الورقية يختلف عن الرصيد المحسوب أعلاه، أدخله هنا وسيقوم النظام تلقائياً بتسجيل الفرق كخصم "تسوية جرد ورقي" في سجل الموظف.'}
                        </p>
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}
                        disabled={saving}
                    >
                        {saving ? 'جاري الحفظ...' : submitLabel}
                    </button>
                </form>
            </div>
        </div>
    );
}
