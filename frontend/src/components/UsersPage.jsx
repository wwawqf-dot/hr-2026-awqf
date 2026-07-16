import { useEffect, useState } from 'react';
import { api } from '../api/client';
import PageHeader from './PageHeader';
import LoadingSpinner from './LoadingSpinner';
import { TableSkeleton } from './SkeletonLoader';
import CustomConfirmModal from './modals/CustomConfirmModal';

export default function UsersPage() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [formError, setFormError] = useState('');
    const [success, setSuccess] = useState('');
    const [saving, setSaving] = useState(false);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('data_entry');

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
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(email) || password.length < 6) {
            setFormError('يرجى إدخال بريد إلكتروني صحيح وكلمة مرور لا تقل عن 6 أحرف');
            return;
        }
        setSaving(true);
        try {
            const data = await api.addUser({ username: email, password, role });
            setSuccess(`تم إنشاء حساب ${data.user.role === 'viewer' ? 'متابع' : 'مُدخل بيانات'}: ${email}`);
            setEmail('');
            setPassword('');
            setRole('data_entry');
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

            <div className="panel" style={{ maxWidth: 600, margin: '0 auto 24px', padding: '1.8rem 2rem', background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid var(--glass-border)', borderRadius: 14 }}>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                    <i className="fas fa-user-plus" style={{ color: 'var(--primary)', fontSize: 20 }}></i>
                    إنشاء حساب مستخدم جديد
                </h2>
                {formError && <div className="form-error">{formError}</div>}
                {success && <div className="form-success">{success}</div>}
                <form className="inline-form" onSubmit={handleAddUser} style={{ flexDirection: 'column', gap: 14 }}>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label>البريد الإلكتروني</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="user@example.com"
                            autoComplete="off"
                            style={{ direction: 'ltr', textAlign: 'left' }}
                        />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label>كلمة المرور</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="6 أحرف على الأقل"
                            style={{ direction: 'ltr', textAlign: 'left' }}
                        />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label>الصلاحية</label>
                        <select value={role} onChange={(e) => setRole(e.target.value)}>
                            <option value="data_entry">مُدخل بيانات</option>
                            <option value="viewer">متابع (قراءة فقط)</option>
                        </select>
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={saving} style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}>
                        {saving && <LoadingSpinner size={16} color="#fff" style={{ marginLeft: 8 }} />}
                        <i className="fas fa-plus" style={saving ? { marginLeft: 4 } : {}}></i> {saving ? 'جاري الإنشاء...' : 'إنشاء حساب المستخدم'}
                    </button>
                </form>
            </div>

            <div className="panel">
                <h2><i className="fas fa-users"></i> قائمة المستخدمين</h2>

                {error && <div className="form-error">{error}</div>}

                {loading ? (
                    <div className="table-container" style={{ maxHeight: 'none', padding: 0, overflow: 'hidden' }}>
                        <TableSkeleton rows={4} cols={4} />
                    </div>
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
                                            <span className={`role-badge${u.role === 'data_entry' ? ' data-entry' : u.role === 'viewer' ? ' viewer' : ''}`}>
                                                {u.role === 'admin' ? 'مدير النظام' : u.role === 'viewer' ? 'متابع' : 'مُدخل بيانات'}
                                            </span>
                                        </td>
                                        <td style={{ color: 'var(--text-muted)' }}>
                                            {new Date(u.createdAt).toLocaleDateString('ar-LY')}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            {u.role !== 'admin' ? (
                                                <button
                                                    type="button"
                                                    className="btn btn-danger-outline btn-icon-text"
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
                    message={`هل أنت متأكد من حذف المستخدم "${confirmUser.username}"؟\nسيتم حذف الحساب نهائياً ولا يمكن التراجع.`}
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
