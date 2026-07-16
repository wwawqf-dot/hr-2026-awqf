import { useMemo, useState } from 'react';
import { useLeaveData } from '../hooks/useLeaveData';
import { getLibyaTime } from '../utils/libyaTime';

const MONTHLY_RATE_30 = 2.5;
const MONTHLY_RATE_45 = 3.75;

export default function LeaveCalculation() {
    const { employees, years, loading } = useLeaveData();
    const [search, setSearch] = useState('');

    const realLibya = useMemo(() => getLibyaTime(), []);
    const realCurrentYear = realLibya.getFullYear();
    const realCurrentMonth = realLibya.getMonth() + 1;

    const sortedYears = useMemo(
        () => [...years].sort((a, b) => Number(a) - Number(b)),
        [years]
    );

    const [activeYear, setActiveYear] = useState(String(realCurrentYear));

    const earnedMonths = useMemo(() => {
        const yr = Number(activeYear);
        return yr < realCurrentYear ? 12 : realCurrentMonth;
    }, [activeYear, realCurrentYear, realCurrentMonth]);

    const rows = useMemo(() => {
        if (!employees.length) return [];
        const q = search.trim().toLowerCase();

        return employees
            .filter((e) => !e.is_frozen)
            .filter((e) => {
                if (!q) return true;
                return (
                    e.name.toLowerCase().includes(q) ||
                    (e.job_number || '').toLowerCase().includes(q)
                );
            })
            .map((emp) => {
                const annualAllowance = emp.over_45 ? 45 : 30;
                const monthlyRate = emp.over_45 ? MONTHLY_RATE_45 : MONTHLY_RATE_30;
                const legalEarned = +(earnedMonths * monthlyRate).toFixed(1);

                const totalDeducted = emp.years_data?.[activeYear]?.deducted
                    ? +emp.years_data[activeYear].deducted
                    : 0;

                let previousCarryOver = parseFloat(emp.initial_carried_forward) || 0;
                for (const yr of sortedYears) {
                    if (yr >= activeYear) break;
                    const added = parseFloat(emp.years_data?.[yr]?.added) || 0;
                    const deducted = parseFloat(emp.years_data?.[yr]?.deducted) || 0;
                    previousCarryOver = previousCarryOver + added - deducted;
                }
                previousCarryOver = Math.max(0, previousCarryOver);

                const consumedFromCurrent = Math.max(0, totalDeducted - previousCarryOver);
                const legalNet = +(legalEarned - consumedFromCurrent).toFixed(1);

                return {
                    id: emp.id,
                    name: emp.name,
                    jobNumber: emp.job_number || '',
                    annualAllowance,
                    legalEarned,
                    totalDeducted,
                    previousCarryOver,
                    consumedFromCurrent,
                    legalNet,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }, [employees, activeYear, earnedMonths, sortedYears, search]);

    if (loading) {
        return <div className="empty-state">جاري التحميل...</div>;
    }

    return (
        <div className="leave-calculation">
            <div className="audit-notice">
                <i className="fas fa-balance-scale"></i>
                <div>
                    <strong>ملاحظة هامة:</strong> هذه الواجهة مخصصة للتدقيق القانوني فقط ولا تؤثر على
                    الأرصدة الفعلية في المنظومة. يعتمد حساب الرصيد المستحق على منهجية FIFO (أولاً
                    بأول) حيث تُستهلك الأرصدة المرحّلة من السنوات السابقة قبل احتساب الاستهلاك من
                    رصيد السنة الحالية.
                </div>
            </div>

            <div className="audit-controls">
                <div className="audit-filters">
                    <div className="form-group" style={{ margin: 0, minWidth: 140 }}>
                        <label style={{ fontSize: '0.82rem', marginBottom: 4 }}>السنة المالية</label>
                        <select
                            value={activeYear}
                            onChange={(e) => setActiveYear(e.target.value)}
                            className="audit-year-select"
                        >
                            {sortedYears.map((y) => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group" style={{ margin: 0, flex: 1 }}>
                        <label style={{ fontSize: '0.82rem', marginBottom: 4 }}>بحث</label>
                        <input
                            type="text"
                            placeholder="بحث سريع عن طريق الاسم أو الرقم الوظيفي..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="audit-search-input"
                        />
                    </div>
                </div>
                <div className="audit-summary">
                    <span className="audit-badge">
                        <i className="fas fa-calendar-alt"></i> الأشهر المحتسبة: {earnedMonths}
                        {Number(activeYear) < realCurrentYear && (
                            <span className="audit-badge-note"> (سنة كاملة)</span>
                        )}
                    </span>
                    <span className="audit-badge">
                        <i className="fas fa-users"></i> عدد الموظفين: {rows.length}
                    </span>
                </div>
            </div>

            <div className="table-container">
                <table className="legal-audit-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>الاسم</th>
                            <th>الرصيد السنوي</th>
                            <th>المستحق ({earnedMonths} شهر)</th>
                            <th>المرحّل من السابق</th>
                            <th>إجمالي المخصوم</th>
                            <th>المستهلك من رصيد {activeYear}</th>
                            <th>الرصيد المتاح حالياً</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="empty-state">لا يوجد موظفون لعرضهم</td>
                            </tr>
                        ) : (
                            rows.map((row, i) => (
                                <tr key={row.id}>
                                    <td>{i + 1}</td>
                                    <td className="name-cell">
                                        {row.name}
                                        {row.jobNumber && (
                                            <span className="job-num-hint">{row.jobNumber}</span>
                                        )}
                                    </td>
                                    <td>{row.annualAllowance} يوم</td>
                                    <td>{row.legalEarned} يوم</td>
                                    <td className="carry-cell">{row.previousCarryOver} يوم</td>
                                    <td className={row.totalDeducted > 0 ? 'consumed-cell' : ''}>
                                        {row.totalDeducted > 0 ? `${row.totalDeducted} يوم` : '—'}
                                    </td>
                                    <td className={row.consumedFromCurrent > 0 ? 'consumed-cell' : ''}>
                                        {row.consumedFromCurrent > 0 ? `${row.consumedFromCurrent} يوم` : '—'}
                                    </td>
                                    <td className={row.legalNet < 0 ? 'negative-cell' : 'positive-cell'}>
                                        {row.legalNet} يوم
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <style>{`
                .leave-calculation { padding: 0 0 1.5rem; }

                .audit-notice {
                    display: flex;
                    align-items: flex-start;
                    gap: 0.85rem;
                    background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(245, 158, 11, 0.02));
                    border: 1px solid rgba(245, 158, 11, 0.25);
                    border-right: 4px solid #f59e0b;
                    border-radius: 10px;
                    padding: 1rem 1.2rem;
                    margin-bottom: 1.25rem;
                    font-size: 0.9rem;
                    line-height: 1.7;
                    color: var(--text-muted, #94a3b8);
                    backdrop-filter: blur(6px);
                }
                .audit-notice i {
                    font-size: 1.6rem;
                    color: #f59e0b;
                    margin-top: 0.15rem;
                    flex-shrink: 0;
                }
                .audit-notice strong { color: #f59e0b; }

                .audit-controls {
                    display: flex;
                    flex-wrap: wrap;
                    align-items: flex-end;
                    justify-content: space-between;
                    gap: 1rem;
                    margin-bottom: 1.25rem;
                }
                .audit-filters {
                    display: flex;
                    align-items: flex-end;
                    gap: 1rem;
                    flex: 1;
                    min-width: 280px;
                }
                .audit-year-select, .audit-search-input {
                    width: 100%;
                    padding: 0.65rem 0.9rem;
                    border-radius: 8px;
                    border: 1px solid var(--table-border, #1f293d);
                    background: var(--card-bg, #0f172a);
                    color: var(--text-main, #fff);
                    font-family: 'Tajawal', sans-serif;
                    font-size: 0.9rem;
                }
                .audit-year-select option { background: #0f172a; color: #fff; }

                .audit-summary {
                    display: flex;
                    gap: 0.75rem;
                    flex-wrap: wrap;
                }
                .audit-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 0.4rem;
                    padding: 0.5rem 0.9rem;
                    border-radius: 8px;
                    background: rgba(96, 165, 250, 0.08);
                    border: 1px solid rgba(96, 165, 250, 0.2);
                    font-size: 0.82rem;
                    color: var(--text-muted, #94a3b8);
                    white-space: nowrap;
                }
                .audit-badge i { color: #60a5fa; }
                .audit-badge-note { color: #f59e0b; font-weight: 600; }

                .legal-audit-table { width: 100%; border-collapse: separate; border-spacing: 0; }
                .legal-audit-table th {
                    padding: 1rem 1rem;
                    text-align: right;
                    border-bottom: 1px solid var(--table-border, #1f293d);
                    background: rgba(255,255,255,0.02);
                    color: var(--text-main);
                    font-weight: 700;
                    font-size: 0.88rem;
                    border-left: 1px solid var(--table-border, #1f293d);
                }
                .legal-audit-table th:last-child { border-left: none; }
                .legal-audit-table td {
                    padding: 0.95rem 1rem;
                    text-align: right;
                    border-bottom: 1px solid var(--table-border, #1f293d);
                    font-size: 0.9rem;
                }
                .legal-audit-table .name-cell {
                    font-weight: 700;
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
                .legal-audit-table .job-num-hint {
                    font-size: 0.75rem;
                    font-weight: 400;
                    color: var(--text-muted, #94a3b8);
                }
                .legal-audit-table .carry-cell { color: #60a5fa; font-weight: 600; }
                .legal-audit-table .consumed-cell { color: var(--danger, #ef4444); font-weight: 700; }
                .legal-audit-table .positive-cell { color: var(--success, #10b981); font-weight: 700; }
                .legal-audit-table .negative-cell { color: var(--danger, #ef4444); font-weight: 700; }
            `}</style>
        </div>
    );
}
