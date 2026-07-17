import { Fragment, useMemo } from 'react';
import { usePermissions } from '../hooks/usePermissions';
import { computeYearlyLedger } from '../utils/leaveCalc';
import { getLastDayPrevMonthStr, getAccruedDays } from '../utils/libyaTime';

export default function EmployeesTable({ employees, years, onDeduct, onEdit, onDelete }) {
    const { canDeduct, canEdit, canDelete } = usePermissions();
    const realLibyaYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Africa/Tripoli', year: 'numeric' }).format(new Date()));

    const sortedEmployees = useMemo(
        () => [...employees].sort((a, b) => (a.is_frozen ? 1 : 0) - (b.is_frozen ? 1 : 0)),
        [employees]
    );

    if (employees.length === 0) {
        return (
            <div className="table-container">
                <div className="empty-state">لا يوجد موظفون مطابقون. ابدأ بإضافة موظف جديد أو عدّل البحث.</div>
            </div>
        );
    }

    const dateSuffix = getLastDayPrevMonthStr().slice(0, 5);

    return (
        <div className="table-container compact-table">
            <table>
                <thead>
                    <tr>
                        <th rowSpan={2} style={{ textAlign: 'center', width: 40 }}>ت</th>
                        <th rowSpan={2} style={{ minWidth: 140 }}>الإسم الكامل</th>
                        <th rowSpan={2}>الرقم الوطني</th>
                        <th rowSpan={2}>الصفة الوظيفية</th>
                        {years.map((year) => (
                            <th key={year} colSpan={4} className="year-group-header">سنة {year}</th>
                        ))}
                        <th rowSpan={2} className="actions-col" style={{ textAlign: 'center', minWidth: 110 }}>الإجراءات</th>
                    </tr>
                    <tr>
                        {years.map((year) => {
                            const yn = Number(year);
                            return (
                                <Fragment key={year}>
                                    <th className="year-opening-header">
                                        (الصافي التراكمي للسنوات السابقة)
                                        <span className="header-sub">حتى تاريخ 31/12/{year - 1}</span>
                                    </th>
                                    <th className="year-col-header">
                                        {yn === realLibyaYear ? (
                                            <div className="added-header-stack">
                                                <span>مضاف {year}</span>
                                                <span className="added-header-sub">حتى {dateSuffix}</span>
                                            </div>
                                        ) : `مضاف ${year}`}
                                    </th>
                                    <th className="year-col-header">مخصوم {year}</th>
                                    <th className="year-col-header">الصافي التراكمي {year}</th>
                                </Fragment>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {sortedEmployees.map((emp, index) => {
                        const ledger = computeYearlyLedger(emp, years);
                        const monthlyRate = emp.over_45 ? 3.75 : 2.5;
                        const enrichedLedger = ledger.map((row) => {
                            if (Number(row.year) === realLibyaYear) {
                                return { ...row, added: getAccruedDays(realLibyaYear, monthlyRate) };
                            }
                            return row;
                        });

                        return (
                            <tr key={emp.id} style={emp.is_frozen ? { opacity: 0.6 } : undefined}>
                                <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{index + 1}</td>
                                <td style={{ fontWeight: 600, color: '#ffffff' }}>
                                    <div className="emp-name-row">
                                        {emp.name}{' '}
                                        {emp.over_45 && <span className="tag-warning">+45 سنة</span>}
                                        {emp.is_frozen && <span className="tag-danger">مُجمّد</span>}
                                    </div>
                                    <div className="emp-job-row">{emp.job_number || '-'}</div>
                                </td>
                                <td style={{ color: 'var(--text-muted)' }}>{emp.national_id || '-'}</td>
                                <td>{emp.job_title || '-'}</td>
                                {enrichedLedger.map((row) => (
                                    <Fragment key={row.year}>
                                        <td className="num-opening">{row.opening}</td>
                                        <td className="num-added">{row.added}</td>
                                        <td className="num-deducted">{row.deducted}</td>
                                        <td className="num-closing">{row.closing}</td>
                                    </Fragment>
                                ))}
                                <td className="actions-col" style={{ textAlign: 'center' }}>
                                    <div className="action-buttons">
                                        {canDeduct && (
                                            <button className="btn btn-primary btn-sm" style={{ transform: 'scale(1.05)', boxShadow: '0 3px 10px rgba(16,185,129,0.35)' }}
                                                onClick={() => onDeduct(emp)} title="خصم إجازة">
                                                <i className="fas fa-minus-circle"></i> خصم
                                            </button>
                                        )}
                                        {canEdit && (
                                            <button className="btn btn-icon btn-warning-outline" onClick={() => onEdit(emp)} title="تعديل">
                                                <i className="fas fa-edit"></i>
                                            </button>
                                        )}
                                        {canDelete && (
                                            <button className="btn btn-icon btn-danger-outline" onClick={() => onDelete(emp)} title="حذف">
                                                <i className="fas fa-trash"></i>
                                            </button>
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
