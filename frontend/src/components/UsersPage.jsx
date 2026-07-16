import { useEffect, useState } from 'react';
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
    const [proxyOk, setProxyOk] = useState(false);
    const [proxyChecking, setProxyChecking] = useState(true);

    // User creation form
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [newUser, setNewUser] = useState({ email: '', password: '', role: 'data_entry' });
    const [createBusy, setCreateBusy] = useState(false);

    // Invite codes
    const [codes, setCodes] = useState([]);
    const [codesLoading, setCodesLoading] = useState(true);
    const [inviteRole, setInviteRole] = useState('data_entry');
    const [generating, setGenerating] = useState(false);
    const [generatedCode, setGeneratedCode] = useState('');
    const [showInviteCard, setShowInviteCard] = useState(false);

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

    async function loadCodes() {
        setCodesLoading(true);
        try {
            const data = await api.getInviteCodes();
            setCodes(data.codes);
        } catch (_) { /* ignore */ }
        finally { setCodesLoading(false); }
    }

    useEffect(() => {
        api.checkProxy().then(ok => {
            setProxyOk(ok);
            setProxyChecking(false);
            if (ok) setShowInviteCard(true);
        });
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
            setToast({ type: 'success', message: `تم حذف المستخدم "${confirmUser.username}" بنجاح` });
            await loadUsers();
        } catch (err) {
            setConfirmUser(null);
            setToast({ type: 'error', message: err.message || 'تعذر حذف المستخدم' });
        } finally {
            setDeleteBusy(false);
        }
    }

    async function handleCreateUser(e) {
        e.preventDefault();
        setCreateBusy(true);
        try {
            const result = await api.addUser(newUser.email, newUser.password, newUser.role);
            setToast({ type: 'success', message: `تم إنشاء المستخدم ${result.email} بنجاح` });
            setNewUser({ email: '', password: '', role: 'data_entry' });
            setShowCreateForm(false);
            await loadUsers();
        } catch (err) {
            setToast({ type: 'error', message: err.message || 'تعذر إنشاء المستخدم' });
        } finally {
            setCreateBusy(false);
        }
    }

    async function handleGenerateCode(e) {
        e.preventDefault();
        setGenerating(true);
        setGeneratedCode('');
        try {
            const code = await api.generateInviteCode(inviteRole);
            setGeneratedCode(code);
            setToast({ type: 'success', message: 'تم توليد رمز الدعوة بنجاح!' });
            await loadCodes();
        } catch (err) {
            setToast({ type: 'error', message: err.message || 'تعذر توليد رمز الدعوة' });
        } finally {
            setGenerating(false);
        }
    }

    function copyLink() {
        const link = window.location.origin + window.location.pathname + '#/register?code=' + generatedCode;
        navigator.clipboard.writeText(link).then(() => {
            setToast({ type: 'success', message: 'تم نسخ رابط الدعوة!' });
        }).catch(() => {
            setToast({ type: 'error', message: 'تعذر النسخ، يرجى النسخ يدوياً' });
        });
    }

    return (
        <>
            <PageHeader />
            {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

            {/* Proxy Status */}
            {!proxyChecking && !proxyOk && (
                <div className="panel" style={{
                    maxWidth: 680, margin: '0 auto 24px', padding: '1.25rem 1.5rem', borderRadius: 16,
                    background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
                    textAlign: 'center',
                }}>
                    <i className="fas fa-plug" style={{ color: '#f59e0b', fontSize: 24, marginBottom: 8 }}></i>
                    <p style={{ color: '#fbbf24', fontWeight: 700, margin: '0 0 4px' }}>
                        خادم الإدارة المحلية غير متصل
                    </p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
                        اشغّل <strong>start.bat</strong> أو <strong>node server.mjs</strong> لإدارة المستخدمين ورموز الدعوة
                    </p>
                </div>
            )}

            {/* Tab toggle: Create User | Invite Codes */}
            {proxyOk && (
                <div className="panel" style={{
                    maxWidth: 680, margin: '0 auto 24px', padding: '1.25rem 1.5rem', borderRadius: 16,
                }}>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
                        <button className={`btn ${!showCreateForm && !showInviteCard ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => { setShowCreateForm(false); setShowInviteCard(false); }}
                            style={{ flex: 1, justifyContent: 'center', borderRadius: 10, minHeight: 44 }}>
                            <i className="fas fa-users-gear"></i> المستخدمين
                        </button>
                        <button className={`btn ${showCreateForm ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => { setShowCreateForm(true); setShowInviteCard(false); }}
                            style={{ flex: 1, justifyContent: 'center', borderRadius: 10, minHeight: 44 }}>
                            <i className="fas fa-user-plus"></i> إضافة مستخدم
                        </button>
                        <button className={`btn ${showInviteCard ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => { setShowCreateForm(false); setShowInviteCard(true); }}
                            style={{ flex: 1, justifyContent: 'center', borderRadius: 10, minHeight: 44,
                                background: showInviteCard ? 'linear-gradient(135deg, #8b5cf6, #7c3aed)' : undefined,
                                borderColor: 'rgba(139,92,246,0.3)', color: showInviteCard ? '#fff' : '#a78bfa' }}>
                            <i className="fas fa-gift"></i> رموز دعوة
                        </button>
                    </div>

                    {/* Create User Form */}
                    {showCreateForm && (
                        <form onSubmit={handleCreateUser}>
                            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                <div className="form-group" style={{ margin: 0, flex: 2, minWidth: 200 }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                        <i className="fas fa-envelope" style={{ color: 'var(--text-muted)', fontSize: 13 }}></i>
                                        البريد الإلكتروني
                                    </label>
                                    <input type="email" required value={newUser.email}
                                        onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                                        placeholder="user@example.com" style={{ minHeight: 48 }} />
                                </div>
                                <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 140 }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                        <i className="fas fa-lock" style={{ color: 'var(--text-muted)', fontSize: 13 }}></i>
                                        كلمة المرور
                                    </label>
                                    <input type="password" required value={newUser.password}
                                        onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                                        placeholder="********" style={{ minHeight: 48 }} />
                                </div>
                                <div className="form-group" style={{ margin: 0, minWidth: 140 }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                        <i className="fas fa-user-tag" style={{ color: 'var(--text-muted)', fontSize: 13 }}></i>
                                        الصلاحية
                                    </label>
                                    <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                                        style={{ minHeight: 48 }}>
                                        <option value="data_entry">مُدخل بيانات</option>
                                        <option value="viewer">متابع (قراءة فقط)</option>
                                    </select>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                                    <button type="submit" className="btn btn-primary" disabled={createBusy}
                                        style={{ minHeight: 48, minWidth: 130, justifyContent: 'center', borderRadius: 12 }}>
                                        {createBusy && <LoadingSpinner size={18} color="#fff" style={{ marginLeft: 10 }} />}
                                        <i className="fas fa-check"></i> {createBusy ? 'جاري...' : 'إنشاء'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    )}

                    {/* Invite Code Generator */}
                    {showInviteCard && (
                        <>
                            <form onSubmit={handleGenerateCode} style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <div className="form-group" style={{ margin: 0, minWidth: 200, flex: 1 }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                        <i className="fas fa-user-tag" style={{ color: 'var(--text-muted)', fontSize: 13 }}></i>
                                        الصلاحية الممنوحة
                                    </label>
                                    <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={{ minHeight: 48 }}>
                                        <option value="data_entry">مُدخل بيانات</option>
                                        <option value="viewer">متابع (قراءة فقط)</option>
                                    </select>
                                </div>
                                <button type="submit" className="btn btn-primary" disabled={generating} style={{
                                    minHeight: 48, minWidth: 160, justifyContent: 'center',
                                    background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', fontSize: '0.95rem', fontWeight: 800, borderRadius: 12,
                                }}>
                                    {generating && <LoadingSpinner size={18} color="#fff" style={{ marginLeft: 10 }} />}
                                    <i className="fas fa-gift"></i> {generating ? 'جاري التوليد...' : 'توليد رمز دعوة'}
                                </button>
                            </form>

                            {generatedCode && (
                                <div style={{
                                    marginTop: 20, padding: '1rem 1.25rem', borderRadius: 12,
                                    background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)',
                                    display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                                }}>
                                    <i className="fas fa-key" style={{ color: '#a78bfa', fontSize: 20 }}></i>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 2 }}>رمز الدعوة</div>
                                        <div style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 800, color: '#c4b5fd', letterSpacing: 1 }}>
                                            {generatedCode}
                                        </div>
                                    </div>
                                    <button type="button" className="btn btn-outline" onClick={copyLink} style={{ minHeight: 44, borderRadius: 10, borderColor: 'rgba(139,92,246,0.3)', color: '#a78bfa' }}>
                                        <i className="fas fa-copy"></i> نسخ الرابط
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* Active Invite Codes */}
            {proxyOk && (
                <div className="panel">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                        <i className="fas fa-ticket" style={{ color: '#a78bfa', fontSize: 18 }}></i>
                        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>رموز الدعوة النشطة</h2>
                        <span style={{
                            marginRight: 'auto', background: 'rgba(139,92,246,0.1)',
                            border: '1px solid rgba(139,92,246,0.2)', borderRadius: 20,
                            padding: '0.15rem 0.7rem', fontSize: '0.78rem', color: '#c4b5fd',
                        }}>{codes.filter(c => !c.is_used).length} نشط</span>
                    </div>
                    {codesLoading ? (
                        <TableSkeleton rows={3} cols={3} />
                    ) : (
                        <div className="table-container" style={{ maxHeight: 'none' }}>
                            <table>
                                <thead>
                                    <tr>
                                        <th>رمز الدعوة</th>
                                        <th>الصلاحية</th>
                                        <th>تاريخ الإنشاء</th>
                                        <th>الحالة</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {codes.length === 0 ? (
                                        <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>لا توجد رموز دعوة بعد</td></tr>
                                    ) : codes.map((c) => (
                                        <tr key={c.code}>
                                            <td style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1, direction: 'ltr' }}>{c.code}</td>
                                            <td><span className={`role-badge${c.role === 'data_entry' ? ' data-entry' : ' viewer'}`}>{c.role === 'data_entry' ? 'مُدخل بيانات' : 'متابع'}</span></td>
                                            <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{new Date(c.created_at).toLocaleDateString('ar-LY')}</td>
                                            <td>
                                                {c.is_used ? (
                                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}><i className="fas fa-check-circle" style={{ color: '#10b981', marginLeft: 4 }}></i>مُستخدم</span>
                                                ) : (
                                                    <span style={{ color: '#a78bfa', fontSize: '0.82rem' }}><i className="fas fa-clock" style={{ marginLeft: 4 }}></i>نشط</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

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
                {loading ? (
                    <TableSkeleton rows={4} cols={4} />
                ) : (
                    <div className="table-container" style={{ maxHeight: 'none' }}>
                        <table>
                            <thead>
                                <tr>
                                    <th>اسم المستخدم</th>
                                    <th>البريد الإلكتروني</th>
                                    <th>الصلاحية</th>
                                    <th>تاريخ الإنشاء</th>
                                    <th style={{ textAlign: 'center' }}>الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.length === 0 ? (
                                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>لا يوجد مستخدمون بعد</td></tr>
                                ) : users.map((u) => (
                                    <tr key={u.id}>
                                        <td style={{ fontWeight: 600 }}>{u.username}</td>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem', direction: 'ltr' }}>{u.email || '—'}</td>
                                        <td>
                                            <span className={`role-badge${u.role === 'data_entry' ? ' data-entry' : u.role === 'viewer' ? ' viewer' : ''}`}>
                                                {u.role === 'admin' ? 'مدير النظام' : u.role === 'viewer' ? 'متابع' : 'مُدخل بيانات'}
                                            </span>
                                        </td>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{u.createdAt ? new Date(u.createdAt).toLocaleDateString('ar-LY') : '—'}</td>
                                        <td style={{ textAlign: 'center' }}>
                                            {u.role !== 'admin' ? (
                                                <button type="button" className="btn btn-danger-outline btn-icon-text"
                                                    disabled={!proxyOk} onClick={() => handleDeleteUser(u)}
                                                    title={!proxyOk ? 'يجب تشغيل الخادم المحلي' : 'حذف المستخدم'}>
                                                    <i className="fas fa-trash"></i> حذف
                                                </button>
                                            ) : (
                                                <span style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 6, padding: '0.25rem 0.7rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                                    <i className="fas fa-shield-halved" style={{ color: '#10b981', marginLeft: 4 }}></i>رئيسي
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
