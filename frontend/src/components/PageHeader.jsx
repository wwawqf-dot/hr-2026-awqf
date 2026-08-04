import { useAuth } from '../context/AuthContext';
import LiveClock from './LiveClock';

export default function PageHeader({ children }) {
    const { user, logout } = useAuth();

    return (
        <header className="header">
            {/* BASE_URL carries the GitHub Pages sub-path in production and
                '/' in dev, and always ends with a slash. */}
            <div className="brand">
                <img
                    className="brand-logo"
                    src={`${import.meta.env.BASE_URL}logo.png`}
                    alt="شعار الهيئة العامة للأوقاف والشؤون الإسلامية"
                />
                <div className="title">
                    <h1>منظومة إجازات الموظفين الرقمية</h1>
                    <p className="org-line">الهيئة العامة للأوقاف والشؤون الإسلامية - مكتب القره بوللي</p>
                    <div className="header-user">
                        <span className={`role-badge${user.role === 'data_entry' ? ' data-entry' : user.role === 'viewer' ? ' viewer' : ''}`}>
                            {user.role === 'admin' ? 'مدير النظام' : user.role === 'viewer' ? 'متابع' : 'مُدخل بيانات'}
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{user.username}</span>
                        <LiveClock />
                    </div>
                </div>
            </div>
            <div className="actions">
                {children}
                <button className="btn btn-danger-outline" onClick={logout} title="تسجيل الخروج">
                    <i className="fas fa-sign-out-alt"></i> خروج
                </button>
            </div>
        </header>
    );
}
