import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
    const { login } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        if (!username.trim() || !password) {
            setError('يرجى إدخال البريد الإلكتروني وكلمة المرور');
            return;
        }
        setSubmitting(true);
        try {
            await login(username.trim(), password);
        } catch (err) {
            setError(err.message || 'تعذر تسجيل الدخول');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="login-screen">
            <div className="login-card">
                <div className="login-logo">
                    <i className="fas fa-calendar-check"></i>
                </div>
                <h1>منظومة إجازات الموظفين الرقمية</h1>
                <p className="subtitle">يرجى تسجيل الدخول للمتابعة</p>

                {error && <div className="form-error">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>البريد الإلكتروني</label>
                        <input
                            type="email"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="أدخل البريد الإلكتروني"
                            autoComplete="username"
                            autoFocus
                        />
                    </div>
                    <div className="form-group">
                        <label>كلمة المرور</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="أدخل كلمة المرور"
                        />
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={submitting}>
                        {submitting ? 'جاري الدخول...' : 'تسجيل الدخول'}
                    </button>
                </form>

                <p className="login-hint">
                    منظومة إدارة الإجازات الخاصة &copy; 2026
                </p>
            </div>
        </div>
    );
}
