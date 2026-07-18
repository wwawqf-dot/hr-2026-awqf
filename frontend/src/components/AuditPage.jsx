import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { formatLibyaTimestamp } from '../utils/libyaTime';
import PageHeader from './PageHeader';
import { TableSkeleton } from './SkeletonLoader';

// Server-side paginated (50 rows/page via Supabase .range()) — this table
// grows forever (every deduction/edit/freeze/sync writes a row), so it is
// never fetched in full. Each page change re-queries Supabase directly;
// React holds only the current page in memory.
export default function AuditPage() {
    const [log, setLog] = useState([]);
    const [page, setPage] = useState(0);
    const [total, setTotal] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');
        api.getAuditLog(page)
            .then((data) => {
                if (!active) return;
                setLog(data.log);
                setTotal(data.total);
                setHasMore(data.hasMore);
            })
            .catch((err) => { if (active) setError(err.message || 'تعذر تحميل سجل النشاطات'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [page]);

    const pageSize = 50;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const rangeStart = total === 0 ? 0 : page * pageSize + 1;
    const rangeEnd = Math.min(total, (page + 1) * pageSize);

    return (
        <>
            <PageHeader />

            <div className="panel">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                    <h2 style={{ margin: 0 }}><i className="fas fa-clipboard-list"></i> سجل نشاطات مُدخلي البيانات</h2>
                    {total > 0 && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            عرض {rangeStart}–{rangeEnd} من أصل {total}
                        </span>
                    )}
                </div>

                {error && <div className="form-error">{error}</div>}

                {loading ? (
                    <div className="table-container" style={{ maxHeight: 'none', padding: 0, overflow: 'hidden' }}>
                        <TableSkeleton rows={5} cols={4} />
                    </div>
                ) : log.length === 0 ? (
                    <div className="empty-state">لا توجد أي أنشطة مسجلة حتى الآن.</div>
                ) : (
                    <>
                        <div className="table-container" style={{ maxHeight: 'none' }}>
                            <table>
                                <thead>
                                    <tr>
                                        <th>الوقت</th>
                                        <th>المستخدم</th>
                                        <th>الإجراء</th>
                                        <th>التفاصيل</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {log.map((entry) => (
                                        <tr key={entry.id}>
                                            <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                                {formatLibyaTimestamp(entry.timestamp)}
                                            </td>
                                            <td style={{ fontWeight: 600 }}>{entry.username}</td>
                                            <td>
                                                <span className="role-badge data-entry">{entry.action}</span>
                                            </td>
                                            <td style={{ whiteSpace: 'normal' }}>{entry.details}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {totalPages > 1 && (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', marginTop: '1rem' }}>
                                <button
                                    type="button"
                                    className="btn btn-outline"
                                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                                    disabled={page === 0}
                                >
                                    <i className="fas fa-chevron-right"></i> الأحدث
                                </button>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                    صفحة {page + 1} من {totalPages}
                                </span>
                                <button
                                    type="button"
                                    className="btn btn-outline"
                                    onClick={() => setPage((p) => p + 1)}
                                    disabled={!hasMore}
                                >
                                    الأقدم <i className="fas fa-chevron-left"></i>
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </>
    );
}
