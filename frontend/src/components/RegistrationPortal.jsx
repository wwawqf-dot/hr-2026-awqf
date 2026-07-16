import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { api, checkProxy } from '../api/client';
import LoadingSpinner from './LoadingSpinner';

export default function RegistrationPortal() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const urlCode = searchParams.get('code') || '';

    const [proxyAvailable, setProxyAvailable] = useState(null);
    const [step, setStep] = useState(urlCode ? 'verify' : 'code');
    const [inviteCode, setInviteCode] = useState(urlCode);
    const [role, setRole] = useState('');
    const [validating, setValidating] = useState(false);
    const [codeError, setCodeError] = useState('');

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [registering, setRegistering] = useState(false);
    const [regError, setRegError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        checkProxy().then(setProxyAvailable);
    }, []);

    useEffect(() => {
        if (urlCode && proxyAvailable) {
            validateCode(urlCode);
        } else if (urlCode && proxyAvailable === false) {
            setCodeError('خادم التحقق غير متاح. يرجى المحاولة لاحقاً.');
            setStep('code');
        }
    }, [urlCode, proxyAvailable]);

    async function validateCode(code) {
        setValidating(true);
        setCodeError('');
        try {
            const result = await api.validateInviteCode(code);
            if (result.valid) {
                setRole(result.role);
                setStep('register');
            } else {
                setCodeError(result.error || 'رمز الدعوة غير صالح');
            }
        } catch (err) {
            setCodeError(err.message || 'رمز الدعوة غير صالح');
        } finally {
            setValidating(false);
        }
    }

    async function handleVerifyCode(e) {
        e.preventDefault();
        if (!proxyAvailable) {
            setCodeError('خادم الإدارة المحلية غير متصل. يرجى من المسؤول تشغيله.');
            return;
        }
        await validateCode(inviteCode.trim());
    }

    async function handleRegister(e) {
        e.preventDefault();
        setRegError('');
        setSuccess('');

        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(email) || password.length < 6 || !name.trim()) {
            setRegError('يرجى ملء جميع الحقول: الاسم، بريد إلكتروني صحيح، وكلمة مرور 6 أحرف على الأقل');
            return;
        }

        setRegistering(true);
        try {
            const { data, error } = await supabase.auth.signUp({
                email: email.trim(),
                password,
                options: {
                    data: { role: role || 'viewer', username: name.trim() },
                },
            });
            if (error) throw error;
            if (!data?.user) throw new Error('تعذر إنشاء الحساب');

            try {
                await api.consumeInviteCode(inviteCode.trim(), data.user.id);
            } catch (_) { /* consume best-effort */ }

            setSuccess(`تم إنشاء الحساب بنجاح!
يمكنك الآن تسجيل الدخول باستخدام بريدك الإلكتروني وكلمة المرور.
`);
            setTimeout(() => navigate('/'), 2000);
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

                {proxyAvailable === false && !urlCode && (
                    <div className="form-error" style={{ marginBottom: 16, padding: '1rem', fontSize: '0.9rem' }}>
                        <i className="fas fa-info-circle" style={{ marginLeft: 6 }}></i>
                        إنشاء الحساب متاح فقط عبر دعوة من المسؤول. يُرجى التواصل مع مدير النظام.
                    </div>
                )}

                {/* Step 1: Enter Invite Code */}
                {step === 'code' && (
                    <form onSubmit={handleVerifyCode}>
                        {codeError && <div className="form-error" style={{ marginBottom: 16 }}>{codeError}</div>}
                        <div className="form-group" style={{ margin: '0 0 16px', textAlign: 'right' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: '0.9rem' }}>
                                <i className="fas fa-key" style={{ color: 'var(--text-muted)', fontSize: 13 }}></i>
                                رمز الدعوة
                            </label>
                            <input
                                type="text"
                                value={inviteCode}
                                onChange={(e) => setInviteCode(e.target.value)}
                                placeholder={proxyAvailable ? 'أدخل رمز الدعوة' : 'الخادم غير متصل...'}
                                disabled={!proxyAvailable}
                                style={{ direction: 'ltr', textAlign: 'center', fontFamily: 'monospace', fontSize: '1.1rem', letterSpacing: 2 }}
                                dir="ltr"
                            />
                        </div>
                        <button type="submit" className="btn btn-primary" disabled={validating || !inviteCode.trim() || !proxyAvailable} style={{
                            width: '100%', justifyContent: 'center', minHeight: 48, fontSize: '1rem', fontWeight: 800, borderRadius: 12,
                            background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                        }}>
                            {validating && <LoadingSpinner size={18} color="#fff" style={{ marginLeft: 10 }} />}
                            <i className="fas fa-check"></i> {validating ? 'جاري التحقق...' : 'تحقق من الرمز'}
                        </button>
                    </form>
                )}

                {/* Step 2: Verifying */}
                {step === 'verify' && (
                    <div style={{ padding: '2rem 0' }}>
                        <LoadingSpinner size={32} color="#8b5cf6" />
                        <p style={{ color: 'var(--text-muted)', marginTop: 16, fontSize: '0.9rem' }}>جاري التحقق من رمز الدعوة...</p>
                        {codeError && <div className="form-error" style={{ marginTop: 12 }}>{codeError}</div>}
                    </div>
                )}

                {/* Step 3: Registration Form */}
                {step === 'register' && (
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
                                <div style={{
                                    background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)',
                                    borderRadius: 10, padding: '0.6rem 1rem', marginBottom: 20,
                                    display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: '#c4b5fd',
                                }}>
                                    <i className="fas fa-tag"></i>
                                    <span style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1, direction: 'ltr' }}>{inviteCode}</span>
                                    <span style={{ marginRight: 'auto', fontSize: '0.82rem' }}>
                                        صلاحية: {role === 'data_entry' ? 'مُدخل بيانات' : 'متابع'}
                                    </span>
                                </div>

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
                                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6 أحرف على الأقل" style={{ direction: 'ltr', textAlign: 'left' }} dir="ltr" />
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
                    {step !== 'register' && <span>لديك حساب بالفعل؟ <a href="#" onClick={(e) => { e.preventDefault(); navigate('/'); }} style={{ color: '#8b5cf6', fontWeight: 700 }}>تسجيل الدخول</a></span>}
                    {step === 'register' && !success && <span style={{ color: '#6b7280' }}>بعد التسجيل يمكنك الدخول مباشرة</span>}
                </div>
            </div>
        </div>
    );
}
