import { useEffect, useState } from 'react';
import { formatDateDisplay } from '../../utils/formatDate';

const emptyForm = { name: '', job_number: '', national_id: '', job_title: '', initial_carried_forward: 0, over_45: false, hire_date_current_year: '', is_unpaid_leave: false, is_memorizer: false };

const JOB_TITLES = ['إداري', 'محفظ', 'محفظة', 'موجه', 'مشرفة', 'مشرف', 'متابع', 'خطيب'];

export default function EmployeeFormModal({ mode, employee, years, openingBalanceDate, onClose, onSubmit }) {
    const [form, setForm] = useState(emptyForm);
    const [yearsAdded, setYearsAdded] = useState({});
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
                hire_date_current_year: employee.hire_date_current_year || '',
                is_unpaid_leave: employee.is_unpaid_leave || false,
                is_memorizer: employee.is_memorizer || false,
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
            await onSubmit({
                name: form.name.trim(),
                job_number: form.job_number.trim(),
                national_id: form.national_id.trim(),
                job_title: form.job_title.trim(),
                initial_carried_forward: Number(form.initial_carried_forward) || 0,
                over_45: form.over_45,
                is_unpaid_leave: form.is_unpaid_leave,
                is_memorizer: form.is_memorizer,
                hire_date_current_year: form.hire_date_current_year || null,
                years_data,
            });
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
                        <label>تاريخ المباشرة (للمعينين حديثاً هذا العام فقط)</label>
                        <input
                            type="date"
                            value={form.hire_date_current_year}
                            onChange={(e) => setForm((f) => ({ ...f, hire_date_current_year: e.target.value }))}
                        />
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: 2 }}>
                            ملاحظة: إذا كانت المباشرة قبل أو في يوم 15 يُحسب رصيد الشهر كاملاً، وإذا كانت بعد يوم 15 لا يُحسب رصيد لهذا الشهر.
                        </span>
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
                    <div className="checkbox-group" style={{ marginTop: '0.5rem' }}>
                        <input
                            type="checkbox"
                            id={`memorizer-${mode}`}
                            checked={form.is_memorizer}
                            onChange={(e) => setForm((f) => ({ ...f, is_memorizer: e.target.checked }))}
                        />
                        <label htmlFor={`memorizer-${mode}`} style={{ color: '#a78bfa' }}>
                            <i className="fas fa-book-quran" style={{ marginLeft: 4 }}></i>
                            تصنيف الموظف: محفظ / محفظة — استثناء الجمعة والسبت من أيام الإجازة
                        </label>
                    </div>
                    <div className="checkbox-group" style={{ marginTop: '0.5rem' }}>
                        <input
                            type="checkbox"
                            id={`unpaid-${mode}`}
                            checked={form.is_unpaid_leave}
                            onChange={(e) => setForm((f) => ({ ...f, is_unpaid_leave: e.target.checked }))}
                        />
                        <label htmlFor={`unpaid-${mode}`} style={{ color: '#f59e0b' }}>
                            <i className="fas fa-ban" style={{ marginLeft: 4 }}></i>
                            إجازة بدون مرتب — يتم تجميد الرصيد وجميع الأرصدة = صفر في التقارير
                        </label>
                    </div>
                    <div style={{ borderTop: '1px dashed var(--table-border)', paddingTop: '1rem' }}>
                        <h4 style={{ color: '#60a5fa', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                            {mode === 'edit' ? 'تعديل مضاف الإجازة لكل سنة نشطة:' : 'تحديد مضاف الإجازة لكل سنة نشطة:'}
                        </h4>
                        {years.map((y) => (
                            <div className="form-group year-input-row" key={y}>
                                <label className="year-input-label">مضاف سنة {y}:</label>
                                <input
                                    type="number"
                                    style={{ flex: 1 }}
                                    value={yearsAdded[y] ?? ''}
                                    onChange={(e) => setYearsAdded((prev) => ({ ...prev, [y]: e.target.value }))}
                                />
                            </div>
                        ))}
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
