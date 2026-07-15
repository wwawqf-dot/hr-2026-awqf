import { useState } from 'react';
import { printEmployeeStatement } from '../../utils/printEmployeeStatement';

// Global "individual statement" modal: pick an employee, then print their
// detailed leave statement. Not tied to a specific table row anymore.
export default function StatementModal({ employees, onClose }) {
    const [selectedId, setSelectedId] = useState('');
    const [error, setError] = useState('');

    const employee = employees.find((e) => e.id === Number(selectedId)) || null;

    function handlePrint() {
        if (!employee) {
            setError('يرجى اختيار الموظف أولاً');
            return;
        }
        printEmployeeStatement(employee);
        onClose();
    }

    return (
        <div className="modal active">
            <div className="modal-content" style={{ maxWidth: 520 }}>
                <div className="modal-header">
                    <h3 className="modal-title"><i className="fas fa-file-invoice"></i> طباعة كشف حساب فردي</h3>
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
                            </option>
                        ))}
                    </select>
                </div>

                {employee && (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1rem' }}>
                        سيتم إصدار كشف حساب تفصيلي للموظف: <b style={{ color: '#60a5fa' }}>{employee.name}</b>
                    </p>
                )}

                <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: '100%', justifyContent: 'center' }}
                    disabled={!employee}
                    onClick={handlePrint}
                >
                    طباعة كشف الحساب الفردي <i className="fas fa-print"></i>
                </button>
            </div>
        </div>
    );
}
