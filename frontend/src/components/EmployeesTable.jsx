import { Fragment } from 'react';
import { useAuth } from '../context/AuthContext';
import { computeBreakdown } from '../utils/leaveCalc';
import { formatDateDisplay } from '../utils/formatDate';

export default function EmployeesTable({ employees, years, openingBalanceDate, onDeduct, onEdit, onDelete }) {
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
                        <th rowSpan={2} className="fixed-header" style={{ minWidth: 170 }}>
                            الرصيد التراكمي (للسنوات السابقة)
                            <br />
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                                (حتى تاريخ {formatDateDisplay(openingBalanceDate)})
                            </span>
                        </th>
                        {years.map((year) => (
                            <th key={year} colSpan={3} className="year-group-header">سنة {year}</th>
                        ))}
                        <th rowSpan={2} style={{ textAlign: 'center', minWidth: 150 }}>الإجراءات</th>
                    </tr>
                    <tr>
                        {years.map((year) => (
                            <Fragment key={year}>
                                <th style={{ textAlign: 'center' }}>المضاف</th>
                                <th style={{ textAlign: 'center' }}>المخصوم</th>
                                <th style={{ textAlign: 'center' }}>الصافي التراكمي</th>
                            </Fragment>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {sortedEmployees.map((emp, index) => {
                        const breakdown = computeBreakdown(emp, years);
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
                                <td style={{ color: '#60a5fa', fontWeight: 'bold', textAlign: 'center' }}>
                                    {emp.initial_carried_forward || 0}
                                </td>
                                {breakdown.map((b) => (
                                    <Fragment key={b.year}>
                                        <td style={{ color: '#34d399', textAlign: 'center' }}>{b.added}</td>
                                        <td style={{ color: 'var(--danger)', textAlign: 'center' }}>{b.deducted}</td>
                                        <td
                                            style={{
                                                color: '#f59e0b',
                                                fontWeight: 'bold',
                                                fontSize: '1.05rem',
                                                textAlign: 'center',
                                            }}
                                        >
                                            {b.runningNet}
                                        </td>
                                    </Fragment>
                                ))}
                                <td style={{ textAlign: 'center' }}>
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
