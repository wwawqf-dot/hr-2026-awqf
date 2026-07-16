import { useEffect, useState, useRef } from 'react';
import { api } from '../api/client';
import PageHeader from './PageHeader';
import LoadingSpinner from './LoadingSpinner';
import { TableSkeleton } from './SkeletonLoader';
import CustomConfirmModal from './modals/CustomConfirmModal';

function Toast({ type, message, onClose }) {
    const colors = {
        success: { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', icon: '#10b981', text: '#d1fae5' },
        error: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', icon: '#ef4444', text: '#fce7f3' },
    };
    const c = colors[type] || colors.error;
    useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
    return (
        <div style={{
            position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
            background: c.bg, backdropFilter: 'blur(16px)', border: `1px solid ${c.border}`,
            borderRadius: 12, padding: '0.85rem 1.5rem', display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)', direction: 'rtl', color: c.text,
            fontSize: '0.92rem', fontWeight: 600, maxWidth: '90%',
            animation: 'fadeInDown 0.35s ease both',
        }}>
            <i className={`fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}`} style={{ color: c.icon, fontSize: 18 }}></i>
            <span style={{ flex: 1 }}>{message}</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: c.text, cursor: 'pointer', padding: 4, fontSize: 16, opacity: 0.6 }}><i className="fas fa-xmark"></i></button>
        </div>
    );
}

export default function UsersPage() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [formError, setFormError] = useState('');
    const [toast, setToast] = useState(null);
    const [saving, setSaving] = useState(false);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('data_entry');

    const [confirmUser, setConfirmUser] = useState(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const formRef = useRef(null);

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

    useEffect(() => { loadUsers(); }, []);

    function handleDeleteUser(user) {
        setError('');
        setConfirmUser(user);
    }

    async function confirmDeleteUser() {
        setDeleteBusy(true);
        try {
            await api.deleteUser(confirmUser.id);
            setConfirmUser(null);
            setToast({ type: 'success', message: `تم حذف المستخدم "${confirmUser.username}" بنجاح` });
            await loadUsers();
        } catch (err) {
            setConfirmUser(null);
            setToast({ type: 'error', message: err.message || 'تعذر حذف المستخدم' });
        } finally {
            setDeleteBusy(false);
        }
    }

    async function handleAddUser(e) {
        e.preventDefault();
        setFormError('');
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(email) || password.length < 6) {
            setFormError('يرجى إدخال بريد إلكتروني صحيح وكلمة مرور لا تقل عن 6 أحرف');
            return;
        }
        setSaving(true);
        try {
            const data = await api.addUser({ username: email, password, role });
            setToast({ type: 'success', message: `تم إنشاء حساب ${data.user.role === 'viewer' ? 'متابع' : 'مُدخل بيانات'}: ${email}` });
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

            {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

            <div className="panel" ref={formRef} style={{
                maxWidth: 600, margin: '0 auto 24px', padding: '2rem 2.2rem',
                background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)', border: '1px solid var(--glass-border)',
                borderRadius: 16,
            }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24,
                    paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: 14,
                        background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#10b981',
                    }}>
                        <i className="fas fa-user-plus"></i>
                    </div>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>إنشاء حساب مستخدم جديد</h2>
                        <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>سيتم إرسال رابط التفعيل تلقائياً للبريد الإلكتروني</p>
                    </div>
                </div>

                {formError && <div className="form-error" style={{ marginBottom: 16 }}>{formError}</div>}

                <form onSubmit={handleAddUser} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                <i className="fas fa-envelope" style={{ color: 'var(--text-muted)', fontSize: 13 }}></i>
                                البريد الإلكتروني
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="user@example.com"
                                autoComplete="off"
                                style={{ direction: 'ltr', textAlign: 'left' }}
                                dir="ltr"
                            />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                <i className="fas fa-lock" style={{ color: 'var(--text-muted)', fontSize: 13 }}></i>
                                كلمة المرور
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="6 أحرف على الأقل"
                                style={{ direction: 'ltr', textAlign: 'left' }}
                                dir="ltr"
                            />
                        </div>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <i className="fas fa-user-tag" style={{ color: 'var(--text-muted)', fontSize: 13 }}></i>
                            الصلاحية
                        </label>
                        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ minHeight: 48 }}>
                            <option value="data_entry">مُدخل بيانات</option>
                            <option value="viewer">متابع (قراءة فقط)</option>
                        </select>
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={saving} style={{
                        width: '100%', justifyContent: 'center', marginTop: 4, minHeight: 48,
                        background: 'linear-gradient(135deg, #10b981, #059669)',
                        fontSize: '1rem', fontWeight: 800, borderRadius: 12,
                    }}>
                        {saving && <LoadingSpinner size={18} color="#fff" style={{ marginLeft: 10 }} />}
                        <i className="fas fa-plus"></i> {saving ? 'جاري الإنشاء...' : 'إنشاء حساب المستخدم'}
                    </button>
                </form>
            </div>

            <div className="panel">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <i className="fas fa-users" style={{ color: '#60a5fa', fontSize: 18 }}></i>
                    <h2 style={{ margin: 0, fontSize: '1.1rem' }}>قائمة المستخدمين</h2>
                    <span style={{
                        marginRight: 'auto', background: 'rgba(96,165,250,0.1)',
                        border: '1px solid rgba(96,165,250,0.2)', borderRadius: 20,
                        padding: '0.15rem 0.7rem', fontSize: '0.78rem', color: '#93c5fd',
                    }}>
                        {users.length} مستخدم
                    </span>
                </div>

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
                                {users.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                                            <i className="fas fa-user-slash" style={{ fontSize: 24, opacity: 0.3, marginBottom: 8, display: 'block' }}></i>
                                            لا يوجد مستخدمون بعد
                                        </td>
                                    </tr>
                                ) : users.map((u) => (
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
                                                <span style={{
                                                    background: 'rgba(16,185,129,0.08)',
                                                    border: '1px solid rgba(16,185,129,0.15)',
                                                    borderRadius: 6, padding: '0.25rem 0.7rem',
                                                    color: 'var(--text-muted)', fontSize: '0.8rem',
                                                }}>
                                                    <i className="fas fa-shield-halved" style={{ color: '#10b981', marginLeft: 4 }}></i>
                                                    رئيسي
                                                </span>
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
