import { useLeaveData } from '../hooks/useLeaveData';
import { getLibyaDateStr } from '../utils/libyaTime';

// Standard legal accrual rate: 30 days / 12 months = 2.5 days per worked
// month. This is a fixed legal reference rate, independent of any
// individual employee's actual 30/45-day operational grant.
const MONTHLY_LEGAL_ACCRUAL_RATE = 2.5;

// ---------------------------------------------------------------------
// <LeaveCalculation /> — "آلية حساب الإجازات" read-only legal audit view.
//
// STRICT ISOLATION: this component only ever READS `employees` from the
// existing `useLeaveData` hook (destructuring just `employees`/`loading`/
// `error` — never any of the hook's mutating functions). It performs its
// own on-the-fly math purely for display and writes nothing back:
//   - no calls to addDeduction/updateEmployee/toggleFreeze/etc.
//   - no changes to the operational 30/45-day upfront grant logic
//   - no changes to the JSON export/backup shape
// It is a self-contained "what would the law say" overlay, entirely
// separate from the system's real (and unchanged) deduction engine.
// ---------------------------------------------------------------------
export default function LeaveCalculation() {
    const { employees, loading, error } = useLeaveData();

    const [currentYear, currentMonthStr] = getLibyaDateStr().split('-');
    const currentMonth = Number(currentMonthStr);
    const legalEarnedDays = MONTHLY_LEGAL_ACCRUAL_RATE * currentMonth;

    return (
        <div className="panel">
            <h2>
                <i className="fas fa-scale-balanced"></i> آلية حساب الإجازات (تدقيق قانوني)
            </h2>

            <div
                style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.6rem',
                    background: 'rgba(245, 158, 11, 0.08)',
                    border: '1px dashed rgba(245, 158, 11, 0.4)',
                    borderRadius: 8,
                    padding: '0.9rem 1.1rem',
                    marginBottom: '1.5rem',
                    color: 'var(--warning)',
                    fontSize: '0.88rem',
                    lineHeight: 1.9,
                }}
            >
                <i className="fas fa-triangle-exclamation" style={{ marginTop: '0.2rem' }}></i>
                <span>
                    ملاحظة هامة: هذه الواجهة مخصصة للتدقيق القانوني فقط ولا تؤثر على الأرصدة الفعلية في المنظومة.
                    يحسب هذا الجدول الرصيد المستحق حتى الشهر الحالي بواقع (2.5 يوم) شهرياً.
                </span>
            </div>

            {error && <div className="form-error">{error}</div>}

            {loading ? (
                <div className="empty-state">جاري التحميل...</div>
            ) : employees.length === 0 ? (
                <div className="empty-state">لا يوجد موظفون لعرض بيانات التدقيق.</div>
            ) : (
                <div className="table-container" style={{ maxHeight: 'none' }}>
                    <table>
                        <thead>
                            <tr>
                                <th>اسم الموظف</th>
                                <th style={{ textAlign: 'center' }}>الرصيد السنوي الممنوح</th>
                                <th style={{ textAlign: 'center' }}>الأيام المستهلكة هذه السنة</th>
                                <th style={{ textAlign: 'center' }}>المستحق قانونياً حتى الآن</th>
                                <th style={{ textAlign: 'center' }}>الصافي القانوني</th>
                            </tr>
                        </thead>
                        <tbody>
                            {employees.map((emp) => {
                                const yearData = emp.years_data?.[currentYear] || {};
                                const annualAllowance = Number(yearData.added) || (emp.over_45 ? 45 : 30);
                                const consumed = Number(yearData.deducted) || 0;
                                const legalNet = legalEarnedDays - consumed;

                                return (
                                    <tr key={emp.id}>
                                        <td style={{ fontWeight: 600 }}>{emp.name}</td>
                                        <td style={{ textAlign: 'center', color: '#60a5fa' }}>{annualAllowance}</td>
                                        <td style={{ textAlign: 'center', color: 'var(--danger)' }}>{consumed}</td>
                                        <td style={{ textAlign: 'center', color: 'var(--emerald)' }}>{legalEarnedDays}</td>
                                        <td
                                            style={{
                                                textAlign: 'center',
                                                fontWeight: 'bold',
                                                color: legalNet < 0 ? 'var(--danger)' : 'var(--warning)',
                                            }}
                                        >
                                            {legalNet}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
