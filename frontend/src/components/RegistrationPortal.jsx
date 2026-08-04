import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { api } from '../api/client';
import LoadingSpinner from './LoadingSpinner';

const ROLE_LABELS = { data_entry: 'مُدخل بيانات', viewer: 'متابع' };

export default function RegistrationPortal() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const urlCode = (searchParams.get('code') || '').trim();

    // The granted role is no longer readable from the code text — codes are
    // now opaque (WQF-<random hex>) and only the server can say what a code
    // is worth, so it is fetched once on mount.
    const [invite, setInvite] = useState(null);
    const [checkingCode, setCheckingCode] = useState(!!urlCode);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [registering, setRegistering] = useState(false);
    const [regError, setRegError] = useState('');
    const [success, setSuccess] = useState('');
    const [step, setStep] = useState('code');

    useEffect(() => {
        let active = true;
        if (!urlCode) { setCheckingCode(false); setStep('code'); return undefined; }

        (async () => {
            const result = await api.validateInviteCode(urlCode);
            if (!active) return;
            if (result.valid) {
                setInvite({ role: result.role, code: urlCode });
                setStep('register');
            } else {
                setRegError(result.error || 'رمز الدعوة غير صحيح أو مستخدم مسبقاً');
                setStep('code');
            }
            setCheckingCode(false);
        })();

        return () => { active = false; };
    }, [urlCode]);

    async function handleRegister(e) {
        e.preventDefault();
        setRegError('');
        setSuccess('');

        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(email) || password.length < 8 || !name.trim()) {
            setRegError('يرجى ملء جميع الحقول: الاسم، بريد إلكتروني صحيح، وكلمة مرور 8 أحرف على الأقل');
            return;
        }

        setRegistering(true);
        try {
            // Re-verify immediately before signUp: the code may have been
            // redeemed by someone else, or revoked, since this page loaded.
            const codeCheck = await api.validateInviteCode(urlCode);
            if (!codeCheck.valid) throw new Error(codeCheck.error || 'رمز الدعوة غير صحيح أو مستخدم مسبقاً');

            const { data, error } = await supabase.auth.signUp({
                email: email.trim(),
                password,
                // No `role` here: the server ignores any client-supplied role and
                // always creates 'viewer'. The real role comes only from
                // consumeInviteCode below, verified server-side.
                options: {
                    data: { username: name.trim() },
                },
            });
            if (error) throw error;
            if (!data?.user) throw new Error('تعذر إنشاء الحساب');

            // Must succeed, not be swallowed: this is the only call that grants
            // anything above 'viewer'. If it fails, the account still exists
            // but stuck at 'viewer' — the user needs to know that, not see a
            // blanket "success".
            await api.consumeInviteCode(urlCode);

            await supabase.auth.signOut();
            localStorage.clear();

            setSuccess('تم إنشاء الحساب بنجاح. يرجى تسجيل الدخول الآن.');
            setTimeout(() => navigate('/'), 1500);
        } catch (err) {
            setRegError(err.message || 'تعذر إنشاء الحساب');
        } finally {
            setRegistering(false);
        }
    }

    return (
        <div style={{
            minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'radial-gradient(ellipse at center, #131a2a 0%, #0b0f19 100%)',
            direction: 'rtl', fontFamily: "'Tajawal', sans-serif", padding: '1rem',
        }}>
            <div className="panel" style={{
                maxWidth: 460, width: '100%', padding: '2.5rem 2.2rem', borderRadius: 20,
                textAlign: 'center',
            }}>
                <div style={{ marginBottom: 24 }}>
                    <div style={{
                        width: 64, height: 64, borderRadius: 18,
                        background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 26, color: '#a78bfa', margin: '0 auto 16px',
                    }}>
                        <i className="fas fa-envelope-open-text"></i>
                    </div>
                    <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: '#f3f4f6' }}>
                        منصة التسجيل الموحّد
                    </h1>
                    <p style={{ margin: '6px 0 0', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                        منظومة إجازات الموظفين الرقمية — مكتب أوقاف القره بوللي
                    </p>
                </div>

                {checkingCode && (
                    <div style={{ padding: '2rem 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                        <LoadingSpinner size={24} color="#8b5cf6" />
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
                            جاري التحقق من رمز الدعوة...
                        </p>
                    </div>
                )}

                {!checkingCode && step === 'code' && (
                    <div style={{ padding: '1.5rem 0' }}>
                        <div className="form-error" style={{ marginBottom: 16, padding: '1rem', fontSize: '0.9rem' }}>
                            <i className="fas fa-info-circle" style={{ marginLeft: 6 }}></i>
                            {regError || 'إنشاء الحساب متاح فقط عبر رابط دعوة من المسؤول.'}
                        </div>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            يُرجى التواصل مع مدير النظام للحصول على رابط التسجيل.
                        </p>
                    </div>
                )}

                {/* Registration Form */}
                {!checkingCode && step === 'register' && (
                    <form onSubmit={handleRegister}>
                        {success ? (
                            <div style={{ padding: '1.5rem 0' }}>
                                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(16,185,129,0.12)', border: '2px solid rgba(16,185,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 24, color: '#10b981' }}>
                                    <i className="fas fa-check"></i>
                                </div>
                                <p style={{ color: '#d1fae5', fontSize: '0.95rem', fontWeight: 700, whiteSpace: 'pre-line' }}>{success}</p>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>جاري تحويلك إلى صفحة تسجيل الدخول...</p>
                            </div>
                        ) : (
                            <>
                                {invite && (
                                    <div style={{
                                        background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)',
                                        borderRadius: 10, padding: '0.6rem 1rem', marginBottom: 20,
                                        display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: '#c4b5fd',
                                    }}>
                                        <i className="fas fa-tag"></i>
                                        <span style={{ marginRight: 'auto', fontSize: '0.82rem' }}>
                                            صلاحية: {ROLE_LABELS[invite.role] || invite.role}
                                        </span>
                                    </div>
                                )}

                                {regError && <div className="form-error" style={{ marginBottom: 16 }}>{regError}</div>}

                                <div className="form-group" style={{ margin: '0 0 14px', textAlign: 'right' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: '0.9rem' }}>
                                        <i className="fas fa-user" style={{ color: 'var(--text-muted)', fontSize: 13 }}></i>
                                        الاسم الكامل
                                    </label>
                                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم كما تراه في النظام" />
                                </div>
                                <div className="form-group" style={{ margin: '0 0 14px', textAlign: 'right' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: '0.9rem' }}>
                                        <i className="fas fa-envelope" style={{ color: 'var(--text-muted)', fontSize: 13 }}></i>
                                        البريد الإلكتروني
                                    </label>
                                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" style={{ direction: 'ltr', textAlign: 'left' }} dir="ltr" />
                                </div>
                                <div className="form-group" style={{ margin: '0 0 20px', textAlign: 'right' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: '0.9rem' }}>
                                        <i className="fas fa-lock" style={{ color: 'var(--text-muted)', fontSize: 13 }}></i>
                                        كلمة المرور
                                    </label>
                                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8 أحرف على الأقل" style={{ direction: 'ltr', textAlign: 'left' }} dir="ltr" />
                                </div>

                                <button type="submit" className="btn btn-primary" disabled={registering} style={{
                                    width: '100%', justifyContent: 'center', minHeight: 48, fontSize: '1rem', fontWeight: 800, borderRadius: 12,
                                    background: 'linear-gradient(135deg, #10b981, #059669)',
                                }}>
                                    {registering && <LoadingSpinner size={18} color="#fff" style={{ marginLeft: 10 }} />}
                                    <i className="fas fa-user-plus"></i> {registering ? 'جاري إنشاء الحساب...' : 'إنشاء حساب'}
                                </button>
                            </>
                        )}
                    </form>
                )}

                <div style={{ marginTop: 24, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    <span>لديك حساب بالفعل؟ <a href="#" onClick={(e) => { e.preventDefault(); navigate('/'); }} style={{ color: '#8b5cf6', fontWeight: 700 }}>تسجيل الدخول</a></span>
                </div>
            </div>
        </div>
    );
}
