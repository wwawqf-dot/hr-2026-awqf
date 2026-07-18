import { useEffect, useState } from 'react';
import { formatDateDisplay } from '../../utils/formatDate';
import LoadingSpinner from '../LoadingSpinner';
import { logActivity } from '../../api/client';

const emptyForm = { name: '', job_number: '', national_id: '', job_title: '', initial_carried_forward: 0, over_45: false, hire_date_current_year: '', is_unpaid_leave: false };

const JOB_TITLES = ['إداري', 'محفظ', 'محفظة', 'موجه', 'مشرفة', 'مشرف', 'متابع', 'خطيب'];

export default function EmployeeFormModal({ mode, employee, years, openingBalanceDate, onClose, onSubmit }) {
    const [form, setForm] = useState(emptyForm);
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
            });
        } else {
            setForm(emptyForm);
        }
        setError('');
    }, [mode, employee]);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        if (!form.name.trim()) {
            setError('يرجى إدخال اسم الموظف كاملاً');
            return;
        }
        setSaving(true);
        try {
            await onSubmit({
                name: form.name.trim(),
                job_number: form.job_number.trim(),
                national_id: form.national_id.trim(),
                job_title: form.job_title.trim(),
                initial_carried_forward: Number(form.initial_carried_forward) || 0,
                over_45: form.over_45,
                is_unpaid_leave: form.is_unpaid_leave,
                hire_date_current_year: form.hire_date_current_year || null,
            });
            if (mode === 'edit') {
                logActivity('تعديل بيانات موظف', `تم تعديل بيانات الموظف "${form.name.trim()}"`).catch(() => {});
            }
            if (form.is_unpaid_leave && mode === 'edit') {
                logActivity('تفعيل إجازة بدون مرتب', `تم تفعيل إجازة بدون مرتب للموظف "${form.name.trim()}" — سيتم تجميد جميع الأرصدة إلى صفر في التقارير`).catch(() => {});
            }
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
                        <span className="text-xs text-gray-400" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: 2 }}>
                            ملاحظة: هذا الحقل مخصص للموظفين المضافين حديثاً فقط لضبط شهر بداية احتساب الرصيد
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
                            onChange={(e) => setForm((f) => ({ ...f, over_45: e.target.checked }))}
                        />
                        <label htmlFor={`over45-${mode}`}>عمر الموظف فوق 50 سنة أو تجاوز 20 سنة من العمل (45 يوماً بدلاً من 30)</label>
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
                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}
                        disabled={saving}
                    >
                        {saving && <LoadingSpinner size={16} color="#fff" style={{ marginLeft: 8 }} />}
                        {saving ? 'جاري الحفظ...' : submitLabel}
                    </button>
                </form>
            </div>
        </div>
    );
}
