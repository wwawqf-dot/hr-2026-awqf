import { Fragment } from 'react';
import { useAuth } from '../context/AuthContext';
import { computeYearlyLedger } from '../utils/leaveCalc';

export default function EmployeesTable({ employees, years, onDeduct, onEdit, onDelete }) {
    const { isAdmin } = useAuth();

    // Push frozen employees to the very bottom while preserving the original
    // order within each group (Array.prototype.sort is stable in modern JS).
    const sortedEmployees = [...employees].sort(
        (a, b) => (a.is_frozen ? 1 : 0) - (b.is_frozen ? 1 : 0)
    );

    if (employees.length === 0) {
        return (
            <div className="table-container">
                <div className="empty-state">لا يوجد موظفون مطابقون. ابدأ بإضافة موظف جديد أو عدّل البحث.</div>
            </div>
        );
    }

    return (
        <div className="table-container">
            <table>
                <thead>
                    <tr>
                        <th rowSpan={2} style={{ textAlign: 'center', width: 50 }}>ت</th>
                        <th rowSpan={2} style={{ textAlign: 'center', minWidth: 110 }}>الرقم الوظيفي</th>
                        <th rowSpan={2} style={{ minWidth: 250 }}>الإسم الكامل</th>
                        <th rowSpan={2}>الرقم الوطني</th>
                        <th rowSpan={2}>الصفة الوظيفية</th>
                        {years.map((year) => (
                            <th key={year} colSpan={4} className="year-group-header">سنة {year}</th>
                        ))}
                        <th rowSpan={2} className="actions-col" style={{ textAlign: 'center', minWidth: 150 }}>
                            الإجراءات
                        </th>
                    </tr>
                    <tr>
                        {years.map((year) => (
                            <Fragment key={year}>
                                <th className="year-opening-header">
                                    (الصافي التراكمي للسنوات السابقة)
                                    <span className="header-sub">حتى تاريخ 31/12/{year - 1}</span>
                                </th>
                                <th className="year-col-header">مضاف {year}</th>
                                <th className="year-col-header">مخصوم {year}</th>
                                <th className="year-col-header">الصافي التراكمي {year}</th>
                            </Fragment>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {sortedEmployees.map((emp, index) => {
                        const ledger = computeYearlyLedger(emp, years);
                        return (
                            <tr key={emp.id} style={emp.is_frozen ? { opacity: 0.7 } : undefined}>
                                <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{index + 1}</td>
                                <td style={{ textAlign: 'center', color: '#60a5fa', fontWeight: 600 }}>
                                    {emp.job_number || '-'}
                                </td>
                                <td style={{ fontWeight: 600, color: '#ffffff' }}>
                                    {emp.name}{' '}
                                    {emp.over_45 && (
                                        <span
                                            style={{
                                                color: '#f59e0b',
                                                fontSize: '0.75rem',
                                                background: 'rgba(245,158,11,0.1)',
                                                padding: '2px 6px',
                                                borderRadius: 4,
                                                marginRight: 5,
                                            }}
                                        >
                                            +45 سنة
                                        </span>
                                    )}
                                    {emp.is_frozen && (
                                        <span
                                            style={{
                                                color: '#ef4444',
                                                fontSize: '0.75rem',
                                                fontWeight: 700,
                                                background: 'rgba(239,68,68,0.12)',
                                                border: '1px solid rgba(239,68,68,0.5)',
                                                padding: '2px 8px',
                                                borderRadius: 4,
                                                marginRight: 5,
                                            }}
                                        >
                                            مُجمّد
                                        </span>
                                    )}
                                </td>
                                <td style={{ color: 'var(--text-muted)' }}>{emp.national_id || '-'}</td>
                                <td>{emp.job_title || '-'}</td>
                                {ledger.map((row) => (
                                    <Fragment key={row.year}>
                                        <td style={{ color: '#60a5fa', fontWeight: 'bold', textAlign: 'center' }}>
                                            {row.opening}
                                        </td>
                                        <td style={{ color: '#34d399', textAlign: 'center' }}>{row.added}</td>
                                        <td style={{ color: 'var(--danger)', textAlign: 'center' }}>{row.deducted}</td>
                                        <td
                                            style={{
                                                color: '#f59e0b',
                                                fontWeight: 'bold',
                                                fontSize: '1.05rem',
                                                textAlign: 'center',
                                            }}
                                        >
                                            {row.closing}
                                        </td>
                                    </Fragment>
                                ))}
                                <td className="actions-col" style={{ textAlign: 'center' }}>
                                    <div className="action-buttons">
                                        <button
                                            className="btn btn-primary"
                                            style={{
                                                padding: '0.6rem 1.1rem',
                                                fontSize: '1.05rem',
                                                fontWeight: 700,
                                                transform: 'scale(1.1)',
                                                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.45)',
                                                gap: '0.4rem',
                                            }}
                                            onClick={() => onDeduct(emp)}
                                            title="خصم إجازة"
                                        >
                                            <i className="fas fa-minus-circle" style={{ fontSize: '1.2rem' }}></i>
                                            خصم
                                        </button>
                                        {isAdmin && (
                                            <>
                                                <button
                                                    className="btn btn-warning-outline"
                                                    style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                                                    onClick={() => onEdit(emp)}
                                                    title="تعديل"
                                                >
                                                    <i className="fas fa-edit"></i>
                                                </button>
                                                <button
                                                    className="btn btn-danger-outline"
                                                    style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                                                    onClick={() => onDelete(emp)}
                                                    title="حذف"
                                                >
                                                    <i className="fas fa-trash"></i>
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
