import { useState } from 'react';
import { printReport } from '../../utils/printReport';

export default function ReportModal({ years, employees, openingBalanceDate, onClose }) {
    const [selected, setSelected] = useState('all');

    function handlePrint() {
        printReport(selected, years, employees, openingBalanceDate);
        onClose();
    }

    return (
        <div className="modal active">
            <div className="modal-content" style={{ maxWidth: 450 }}>
                <div className="modal-header">
                    <h3 className="modal-title"><i className="fas fa-print"></i> طباعة التقارير</h3>
                    <button className="close-modal" onClick={onClose}>&times;</button>
                </div>
                <div className="form-group">
                    <label>اختر نوع التقرير أو السنة المالية:</label>
                    <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                        <option value="all">تقرير شامل</option>
                        {years.map((y) => (
                            <option key={y} value={y}>تقرير مخصص لسنة {y}</option>
                        ))}
                    </select>
                </div>
                <button
                    className="btn btn-primary"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={handlePrint}
                >
                    إصدار وطباعة التقرير
                </button>
            </div>
        </div>
    );
}
