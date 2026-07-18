import { useEffect, useState } from 'react';
import { api } from '../api/client';
import PageHeader from './PageHeader';
import { TableSkeleton } from './SkeletonLoader';

function formatTimestamp(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const parts = new Intl.DateTimeFormat('ar-LY', {
        timeZone: 'Africa/Tripoli',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    }).formatToParts(d);
    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

const PAGE_SIZE = 50;

export default function ActivityLog() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [page, setPage] = useState(0);
    const [total, setTotal] = useState(0);
    const [hasMore, setHasMore] = useState(false);

    async function loadPage(pageNum) {
        setLoading(true);
        setError('');
        try {
            const data = await api.getActivityLog(pageNum);
            setLogs(data.log);
            setPage(data.page);
            setTotal(data.total);
            setHasMore(data.hasMore);
        } catch (err) {
            setError(err.message || 'تعذر تحميل سجل النشاطات');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { loadPage(0); }, []);

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return (
        <>
            <PageHeader />
            <div className="panel">
                <h2><i className="fas fa-shield-alt"></i> سجل النشاطات</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                    سجل أمني لجميع الإجراءات التي تمت في النظام — متاح للمدير فقط.
                </p>

                {error && <div className="form-error">{error}</div>}

                {loading ? (
                    <div className="table-container" style={{ padding: 0, overflow: 'hidden' }}>
                        <TableSkeleton rows={7} cols={4} />
                    </div>
                ) : (
                    <>
                        <div className="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>المستخدم</th>
                                        <th>نوع الإجراء</th>
                                        <th>التفاصيل</th>
                                        <th style={{ textAlign: 'center' }}>التاريخ والوقت</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                                                لا توجد نشاطات مسجلة بعد.
                                            </td>
                                        </tr>
                                    ) : (
                                        logs.map((log) => (
                                            <tr key={log.id}>
                                                <td style={{ fontWeight: 600, color: '#60a5fa' }}>{log.userEmail}</td>
                                                <td>
                                                    <span style={{
                                                        background: log.actionType === 'تسجيل إجازة' ? 'rgba(16,185,129,0.1)' :
                                                            log.actionType === 'أرشفة موظف' || log.actionType === 'أرشفة سنة مالية' ? 'rgba(239,68,68,0.1)' :
                                                                log.actionType === 'استعادة موظف' || log.actionType === 'استعادة سنة مالية' ? 'rgba(96,165,250,0.1)' :
                                                                    log.actionType === 'تجميد موظف' || log.actionType === 'إلغاء تجميد موظف' ? 'rgba(245,158,11,0.1)' :
                                                                        'rgba(255,255,255,0.05)',
                                                        color: log.actionType === 'تسجيل إجازة' ? 'var(--emerald)' :
                                                            log.actionType === 'أرشفة موظف' || log.actionType === 'أرشفة سنة مالية' ? 'var(--danger)' :
                                                                log.actionType === 'استعادة موظف' || log.actionType === 'استعادة سنة مالية' ? '#60a5fa' :
                                                                    log.actionType === 'تجميد موظف' || log.actionType === 'إلغاء تجميد موظف' ? '#f59e0b' :
                                                                        'var(--text-main)',
                                                        padding: '0.2rem 0.6rem',
                                                        borderRadius: 6,
                                                        fontWeight: 700,
                                                        fontSize: '0.85rem',
                                                        display: 'inline-block',
                                                    }}>
                                                        {log.actionType}
                                                    </span>
                                                </td>
                                                <td style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>{log.details}</td>
                                                <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', direction: 'ltr' }}>
                                                    {formatTimestamp(log.timestamp)}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {totalPages > 1 && (
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.6rem', marginTop: '1.25rem' }}>
                                <button
                                    className="btn btn-icon"
                                    disabled={page === 0}
                                    onClick={() => loadPage(page - 1)}
                                >
                                    <i className="fas fa-chevron-right"></i>
                                </button>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                                    الصفحة {page + 1} من {totalPages} ({total} إجمالي)
                                </span>
                                <button
                                    className="btn btn-icon"
                                    disabled={!hasMore}
                                    onClick={() => loadPage(page + 1)}
                                >
                                    <i className="fas fa-chevron-left"></i>
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </>
    );
}