import { useExpiringLeaves } from '../hooks/useExpiringLeaves';
import { formatDateDisplay } from '../utils/formatDate';
import { WidgetSkeleton } from './SkeletonLoader';

// Small dashboard card listing employees whose leave ends within the short
// window around today (see the /deductions/expiring route). Shown to all roles.
export default function ExpiringLeavesWidget() {
    const { items, loading } = useExpiringLeaves();

    return (
        <div
            className="table-container"
            style={{ padding: '1.1rem 1.25rem', marginBottom: '1.25rem' }}
        >
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <i className="fas fa-hourglass-half" style={{ color: '#f59e0b' }}></i>
                إجازات قاربت على الانتهاء
            </h3>

            {loading ? (
                <WidgetSkeleton />
            ) : items.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                    لا توجد إجازات تنتهي قريباً
                </p>
            ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {items.map((item, index) => (
                        <li
                            key={`${item.job_number || item.name}-${item.end_date}-${index}`}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '1rem',
                                fontSize: '0.9rem',
                                borderBottom: index < items.length - 1 ? '1px solid var(--table-border)' : 'none',
                                paddingBottom: '0.4rem',
                            }}
                        >
                            <span style={{ fontWeight: 600, color: '#ffffff' }}>{item.name}</span>
                            <span style={{ color: '#f59e0b', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                تنتهي بتاريخ {formatDateDisplay(item.end_date)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
