import { Fragment, useMemo } from 'react';
import { usePermissions } from '../hooks/usePermissions';
import { getAllocationPeriodEndStr, getLibyaYear } from '../utils/libyaTime';
import { computeYearlyLedger } from '../utils/leaveCalc';

export default function EmployeesTable({ employees, years, onDeduct, onEdit, onDelete }) {
    const { canDeduct, canEdit, canDelete } = usePermissions();
    // Always through the central Tripoli-locked utility — never an inline
    // Intl.DateTimeFormat duplicate (there were three of these scattered
    // across the app; consolidated to one source of truth).
    const realLibyaYear = Number(getLibyaYear());

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

    // Full "dd/mm/yyyy" — do NOT truncate. A truncated "31/12" silently drops
    // the year, which is exactly wrong the one week a year that matters:
    // right after a year flip, when the closing year and the newly opened
    // one sit side by side in the table (e.g. "31/12/2026" vs "31/12/2027").
    // The whole year's days are granted up front, so this is the year's own
    // end date and it rolls over by itself each 1 January.
    const allocationEndDate = getAllocationPeriodEndStr();

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
                                                <span className="added-header-sub">(حتى {allocationEndDate})</span>
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
                        // Reads the stored grant for every year verbatim; the
                        // only figure it derives is the running carry-forward.
                        // is_unpaid_leave zeroing lives inside the shared
                        // utility so the table, the print report and the Excel
                        // export can never disagree about it.
                        const enrichedLedger = computeYearlyLedger(emp, years, realLibyaYear);

                        return (
                            <tr key={emp.id} style={emp.is_frozen ? { opacity: 0.6 } : undefined}>
                                <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{index + 1}</td>
                                <td style={{ fontWeight: 600, color: '#ffffff' }}>
                                    <div className="emp-name-row">
                                        {emp.name}{' '}
                                        {emp.over_45 && <span className="tag-warning" title="يستحق 45 يوماً سنوياً بدلاً من 30">+45</span>}
                                        {emp.is_frozen && <span className="tag-danger">مُجمّد</span>}
                                        {emp.is_unpaid_leave && <span className="tag-unpaid" title="إجازة بدون مرتب — الرصيد التراكمي محفوظ، استحقاق السنة الحالية مجمّد">إجازة بدون مرتب</span>}
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
