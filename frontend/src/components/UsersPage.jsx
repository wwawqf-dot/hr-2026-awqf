import { useEffect, useState } from 'react';
import { api } from '../api/client';
import PageHeader from './PageHeader';

export default function UsersPage() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    async function loadUsers() {
        setLoading(true);
        setError('');
        try {
            const data = await api.getUsers();
            setUsers(data.users);
        } catch (err) {
            setError(err.message || 'تعذر تحميل قائمة المستخدمين');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadUsers();
    }, []);

    return (
        <>
            <PageHeader />

            <div className="panel">
                <h2><i className="fas fa-users-cog"></i> إدارة المستخدمين</h2>

                <div className="info-card" style={{ background: 'var(--bg-warning)', padding: '1rem', borderRadius: 8, marginBottom: 20, border: '1px solid var(--border-color)' }}>
                    <i className="fas fa-info-circle" style={{ marginLeft: 8 }}></i>
                    يتم إنشاء المستخدمين عبر لوحة تحكم Supabase: <strong>Authentication &gt; Users &gt; Add User</strong>.
                    عند إنشاء مستخدم جديد، يتم إنشاء صلاحياته تلقائياً. المستخدمون الحاليون معروضون أدناه.
                </div>

                {error && <div className="form-error">{error}</div>}

                {loading ? (
                    <div className="empty-state">جاري التحميل...</div>
                ) : (
                    <div className="table-container" style={{ maxHeight: 'none' }}>
                        <table>
                            <thead>
                                <tr>
                                    <th>اسم المستخدم</th>
                                    <th>الصلاحية</th>
                                    <th>تاريخ الإنشاء</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((u) => (
                                    <tr key={u.id}>
                                        <td style={{ fontWeight: 600 }}>{u.username}</td>
                                        <td>
                                            <span className={`role-badge${u.role === 'data_entry' ? ' data-entry' : ''}`}>
                                                {u.role === 'admin' ? 'مدير النظام' : 'مُدخل بيانات'}
                                            </span>
                                        </td>
                                        <td style={{ color: 'var(--text-muted)' }}>
                                            {new Date(u.createdAt).toLocaleDateString('ar-LY')}
                                        </td>
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
