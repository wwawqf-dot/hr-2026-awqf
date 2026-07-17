import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { api } from '../api/client';
import PageHeader from './PageHeader';
import LoadingSpinner from './LoadingSpinner';
import { TableSkeleton } from './SkeletonLoader';
import CustomConfirmModal from './modals/CustomConfirmModal';

const ROLE_LABELS = { admin: 'مدير النظام', data_entry: 'مُدخل بيانات', viewer: 'متابع' };

function Toast({ type, message, onClose }) {
    const colors = {
        success: { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', icon: '#10b981', text: '#d1fae5' },
        error: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', icon: '#ef4444', text: '#fce7f3' },
    };
    const c = colors[type] || colors.error;
    useEffect(() => { const t = setTimeout(onClose, 5000); return () => clearTimeout(t); }, [onClose]);
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
    const [toast, setToast] = useState(null);
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

    useEffect(() => { loadUsers(); }, []);

    function handleDeleteUser(user) {
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

    async function handleRoleChange(userId, newRole) {
        const prev = users.find((u) => u.id === userId);
        setUsers((prevList) => prevList.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
        try {
            const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
            if (error) throw error;
            setToast({ type: 'success', message: 'تم تحديث الصلاحية بنجاح' });
        } catch (err) {
            setUsers((prevList) => prevList.map((u) => (u.id === userId ? { ...u, role: prev.role } : u)));
            setToast({ type: 'error', message: err.message || 'تعذر تحديث الصلاحية' });
        }
    }

    return (
        <>
            <PageHeader />
            {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

            {/* Supabase Dashboard Link */}
            <div className="panel" style={{
                maxWidth: 680, margin: '0 auto 24px', padding: '1.5rem 2rem', borderRadius: 16,
                display: 'flex', alignItems: 'center', gap: 16,
            }}>
                <div style={{
                    width: 48, height: 48, borderRadius: 14,
                    background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                    <i className="fas fa-database" style={{ color: '#60a5fa', fontSize: 20 }}></i>
                </div>
                <div style={{ flex: 1 }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>إدارة المستخدمين عبر Supabase</h3>
                    <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        يتم إنشاء المستخدمين وحذفهم من لوحة Supabase Dashboard. الصلاحيات الافتراضية للمستخدم الجديد هي <strong>متابع</strong>، ويمكنك تعديلها من الجدول أدناه.
                    </p>
                </div>
                <a href="https://supabase.com/dashboard/project/uzmhsesmszngkanjsjgy/auth/users" target="_blank" rel="noopener noreferrer"
                    className="btn btn-primary" style={{
                        minHeight: 44, whiteSpace: 'nowrap', justifyContent: 'center', borderRadius: 10,
                        background: 'linear-gradient(135deg, #3b82f6, #2563eb)', fontSize: '0.88rem',
                    }}>
                    <i className="fas fa-external-link-alt"></i> إضافة مستخدم جديد
                </a>
            </div>

            {/* Users List */}
            <div className="panel">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <i className="fas fa-users" style={{ color: '#60a5fa', fontSize: 18 }}></i>
                    <h2 style={{ margin: 0, fontSize: '1.1rem' }}>قائمة المستخدمين</h2>
                    <span style={{
                        marginRight: 'auto', background: 'rgba(96,165,250,0.1)',
                        border: '1px solid rgba(96,165,250,0.2)', borderRadius: 20,
                        padding: '0.15rem 0.7rem', fontSize: '0.78rem', color: '#93c5fd',
                    }}>{users.length} مستخدم</span>
                </div>

                {error && <div className="form-error">{error}</div>}
                {loading ? <TableSkeleton rows={4} cols={4} /> : (
                    <div className="table-container" style={{ maxHeight: 'none' }}>
                        <table>
                            <thead><tr>
                                <th>اسم المستخدم</th><th>الصلاحية</th><th>تاريخ الإنشاء</th>
                                <th style={{ textAlign: 'center' }}>الإجراءات</th>
                            </tr></thead>
                            <tbody>
                                {users.length === 0 ? (
                                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>لا يوجد مستخدمون بعد</td></tr>
                                ) : users.map((u) => {
                                    const isCurrentUser = u.role === 'admin' && users.filter(x => x.role === 'admin').length === 1;
                                    return (
                                        <tr key={u.id}>
                                            <td style={{ fontWeight: 600 }}>{u.username}</td>
                                            <td>
                                                <select
                                                    value={u.role}
                                                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                                                    style={{
                                                        minHeight: 36, fontSize: '0.82rem', borderRadius: 8,
                                                        padding: '0.2rem 0.5rem', minWidth: 120,
                                                        background: u.role === 'admin'
                                                            ? 'rgba(16,185,129,0.1)'
                                                            : u.role === 'data_entry'
                                                                ? 'rgba(96,165,250,0.08)'
                                                                : 'rgba(168,85,247,0.08)',
                                                        border: u.role === 'admin'
                                                            ? '1px solid rgba(16,185,129,0.25)'
                                                            : u.role === 'data_entry'
                                                                ? '1px solid rgba(96,165,250,0.2)'
                                                                : '1px solid rgba(168,85,247,0.2)',
                                                        color: u.role === 'admin'
                                                            ? '#34d399'
                                                            : u.role === 'data_entry'
                                                                ? '#93c5fd'
                                                                : '#c4b5fd',
                                                        fontWeight: 700, cursor: 'pointer',
                                                    }}
                                                >
                                                    <option value="viewer" style={{ color: '#c4b5fd', background: '#1e1b2e' }}>متابع</option>
                                                    <option value="data_entry" style={{ color: '#93c5fd', background: '#1e1b2e' }}>مُدخل بيانات</option>
                                                    <option value="admin" style={{ color: '#34d399', background: '#1e1b2e' }}>مدير النظام</option>
                                                </select>
                                            </td>
                                            <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{new Date(u.createdAt).toLocaleDateString('ar-LY')}</td>
                                            <td style={{ textAlign: 'center' }}>
                                                {u.role !== 'admin' ? (
                                                    <button type="button" className="btn btn-danger-outline btn-icon-text"
                                                        onClick={() => handleDeleteUser(u)}>
                                                        <i className="fas fa-trash"></i> حذف
                                                    </button>
                                                ) : (
                                                    <span style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 6, padding: '0.25rem 0.7rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                                        <i className="fas fa-shield-halved" style={{ color: '#10b981', marginLeft: 4 }}></i>رئيسي
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
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
