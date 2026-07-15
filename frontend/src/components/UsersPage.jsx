import { useEffect, useState } from 'react';
import { api } from '../api/client';
import PageHeader from './PageHeader';
import CustomConfirmModal from './modals/CustomConfirmModal';

export default function UsersPage() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [formError, setFormError] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [success, setSuccess] = useState('');
    const [saving, setSaving] = useState(false);
    const [confirmUser, setConfirmUser] = useState(null);
    const [deleteBusy, setDeleteBusy] = useState(false);

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

    function handleDeleteUser(user) {
        setError('');
        setConfirmUser(user);
    }

    async function confirmDeleteUser() {
        setDeleteBusy(true);
        try {
            await api.deleteUser(confirmUser.id);
            setConfirmUser(null);
            await loadUsers();
        } catch (err) {
            setConfirmUser(null);
            setError(err.message || 'تعذر حذف المستخدم');
        } finally {
            setDeleteBusy(false);
        }
    }

    async function handleAddUser(e) {
        e.preventDefault();
        setFormError('');
        setSuccess('');
        const email = username.trim();
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(email) || password.length < 6) {
            setFormError('يرجى إدخال بريد إلكتروني صحيح وكلمة مرور لا تقل عن 6 أحرف');
            return;
        }
        setSaving(true);
        try {
            await api.addUser({ username: email, password });
            // Passwords are stored hashed by Supabase and can't be shown
            // again — surface the credentials once so the admin can pass
            // them on.
            setSuccess(`تم إنشاء حساب مُدخل البيانات: ${email} — أبلغه بكلمة المرور التي أدخلتها الآن (لن تظهر مرة أخرى).`);
            setUsername('');
            setPassword('');
            await loadUsers();
        } catch (err) {
            setFormError(err.message || 'تعذر إضافة المستخدم');
        } finally {
            setSaving(false);
        }
    }

    return (
        <>
            <PageHeader />

            <div className="panel">
                <h2><i className="fas fa-user-plus"></i> إضافة مستخدم إدخال بيانات</h2>
                {formError && <div className="form-error">{formError}</div>}
                {success && <div className="form-success">{success}</div>}
                <form className="inline-form" onSubmit={handleAddUser}>
                    <div className="form-group">
                        <label>البريد الإلكتروني</label>
                        <input type="email" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="user@example.com" autoComplete="off" />
                    </div>
                    <div className="form-group">
                        <label>كلمة المرور</label>
                        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة المرور (6 أحرف على الأقل)" />
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={saving}>
                        <i className="fas fa-plus"></i> {saving ? 'جاري الإضافة...' : 'إضافة مستخدم'}
                    </button>
                </form>

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
                                    <th style={{ textAlign: 'center' }}>الإجراءات</th>
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
                                        <td style={{ textAlign: 'center' }}>
                                            {u.role === 'data_entry' ? (
                                                <button
                                                    type="button"
                                                    className="btn btn-danger-outline"
                                                    style={{ padding: '0.4rem 0.7rem', fontSize: '0.85rem' }}
                                                    onClick={() => handleDeleteUser(u)}
                                                    title="حذف المستخدم"
                                                >
                                                    <i className="fas fa-trash"></i> حذف
                                                </button>
                                            ) : (
                                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {confirmUser && (
                <CustomConfirmModal
                    title="حذف مستخدم"
                    message={`هل أنت متأكد من حذف المستخدم "${confirmUser.username}"؟\nلا يمكن التراجع عن هذا الإجراء.`}
                    confirmLabel="نعم، احذف المستخدم"
                    cancelLabel="إلغاء"
                    busy={deleteBusy}
                    onConfirm={confirmDeleteUser}
                    onCancel={() => setConfirmUser(null)}
                />
            )}
        </>
    );
}
