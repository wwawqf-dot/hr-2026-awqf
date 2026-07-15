import { useAuth } from '../context/AuthContext';
import LiveClock from './LiveClock';

export default function PageHeader({ children }) {
    const { user, logout } = useAuth();

    return (
        <header className="header">
            <div className="title">
                <h1>منظومة إجازات الموظفين الرقمية</h1>
                <p className="org-line">الهيئة العامة للأوقاف والشؤون الإسلامية - مكتب القره بوللي</p>
                <div className="header-user">
                    <span className={`role-badge${user.role === 'data_entry' ? ' data-entry' : ''}`}>
                        {user.role === 'admin' ? 'مدير النظام' : 'مُدخل بيانات'}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{user.username}</span>
                    <LiveClock />
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
