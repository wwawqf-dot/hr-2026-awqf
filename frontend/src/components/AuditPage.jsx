import { useEffect, useState } from 'react';
import { api } from '../api/client';
import PageHeader from './PageHeader';
import { TableSkeleton } from './SkeletonLoader';

export default function AuditPage() {
    const [log, setLog] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        api.getAuditLog()
            .then((data) => setLog(data.log))
            .catch((err) => setError(err.message || 'تعذر تحميل سجل النشاطات'))
            .finally(() => setLoading(false));
    }, []);

    return (
        <>
            <PageHeader />

            <div className="panel">
                <h2><i className="fas fa-clipboard-list"></i> سجل نشاطات مُدخلي البيانات</h2>

                {error && <div className="form-error">{error}</div>}

                {loading ? (
                    <div className="table-container" style={{ maxHeight: 'none', padding: 0, overflow: 'hidden' }}>
                        <TableSkeleton rows={5} cols={4} />
                    </div>
                ) : log.length === 0 ? (
                    <div className="empty-state">لا توجد أي أنشطة مسجلة حتى الآن.</div>
                ) : (
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
                                            {new Date(entry.timestamp).toLocaleString('ar-LY')}
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
                )}
            </div>
        </>
    );
}
