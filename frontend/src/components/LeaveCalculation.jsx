import { useMemo } from 'react';
import { useLeaveData } from '../hooks/useLeaveData';
import { getLibyaTime } from '../utils/libyaTime';
import PageHeader from './PageHeader';

const MONTHLY_RATE_30 = 2.5;
const MONTHLY_RATE_45 = 3.75;

export default function LeaveCalculation() {
    const { employees, loading } = useLeaveData();

    const currentMonth = useMemo(() => getLibyaTime().getMonth() + 1, []);

    const rows = useMemo(() => {
        if (!employees.length) return [];
        const currentYear = String(getLibyaTime().getFullYear());

        return employees
            .filter((e) => !e.is_frozen)
            .map((emp) => {
                const annualAllowance = emp.over_45 ? 45 : 30;
                const monthlyRate = emp.over_45 ? MONTHLY_RATE_45 : MONTHLY_RATE_30;
                const legalEarned = +(monthlyRate * currentMonth).toFixed(1);
                const consumed = emp.years_data?.[currentYear]?.deducted
                    ? +emp.years_data[currentYear].deducted
                    : 0;
                const legalNet = +(legalEarned - consumed).toFixed(1);

                return { id: emp.id, name: emp.name, annualAllowance, consumed, legalEarned, legalNet };
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }, [employees, currentMonth]);

    if (loading) {
        return (
            <>
                <PageHeader />
                <div className="empty-state">جاري التحميل...</div>
            </>
        );
    }

    return (
        <>
            <PageHeader />
            <div className="leave-calculation">
                <div className="audit-notice">
                    <i className="fas fa-balance-scale"></i>
                    <div>
                        <strong>ملاحظة هامة:</strong> هذه الواجهة مخصصة للتدقيق القانوني فقط ولا تؤثر على
                        الأرصدة الفعلية في المنظومة. يحسب هذا الجدول الرصيد المستحق حتى الشهر الحالي
                        بواقع (2.5 يوم) شهرياً للموظفين العاديين و(3.75 يوم) شهرياً لمن تتجاوز خدمتهم
                        45 سنة.
                    </div>
                </div>

                <div className="table-container">
                    <table className="legal-audit-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>الاسم</th>
                                <th>الرصيد السنوي</th>
                                <th>المستحق حتى شهر {currentMonth}</th>
                                <th>المستهلك</th>
                                <th>صافي الرصيد القانوني</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="empty-state">لا يوجد موظفون لعرضهم</td>
                                </tr>
                            ) : (
                                rows.map((row, i) => (
                                    <tr key={row.id}>
                                        <td>{i + 1}</td>
                                        <td className="name-cell">{row.name}</td>
                                        <td>{row.annualAllowance} يوم</td>
                                        <td>{row.legalEarned} يوم</td>
                                        <td className={row.consumed > 0 ? 'consumed-cell' : ''}>
                                            {row.consumed > 0 ? `${row.consumed} يوم` : '—'}
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
                    margin-bottom: 1.5rem;
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

                .legal-audit-table { width: 100%; border-collapse: separate; border-spacing: 0; white-space: nowrap; }
                .legal-audit-table th {
                    padding: 1.1rem 1.2rem;
                    text-align: right;
                    border-bottom: 1px solid var(--table-border, #1f293d);
                    background: rgba(255,255,255,0.02);
                    color: var(--text-main);
                    font-weight: 700;
                    font-size: 0.95rem;
                    border-left: 1px solid var(--table-border, #1f293d);
                }
                .legal-audit-table th:last-child { border-left: none; }
                .legal-audit-table td {
                    padding: 1.1rem 1.2rem;
                    text-align: right;
                    border-bottom: 1px solid var(--table-border, #1f293d);
                    font-size: 0.93rem;
                }
                .legal-audit-table .name-cell { font-weight: 700; }
                .legal-audit-table .consumed-cell { color: var(--danger, #ef4444); font-weight: 700; }
                .legal-audit-table .positive-cell { color: var(--success, #10b981); font-weight: 700; }
                .legal-audit-table .negative-cell { color: var(--danger, #ef4444); font-weight: 700; }
            `}</style>
        </>
    );
}
