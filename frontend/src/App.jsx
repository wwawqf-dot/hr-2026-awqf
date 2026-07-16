import { useState } from 'react';
import { useAuth } from './context/AuthContext';
import Login from './components/Login';
import NavTabs from './components/NavTabs';
import EmployeesPage from './components/EmployeesPage';
import UsersPage from './components/UsersPage';
import AuditPage from './components/AuditPage';
import SettingsPage from './components/SettingsPage';
import Regulations from './components/Regulations';
import LeaveCalculation from './components/LeaveCalculation';

const PUBLIC_TABS = ['employees', 'regulations', 'auditCalc'];
const ADMIN_TABS = ['users', 'audit', 'settings'];

export default function App() {
    const { user, loading } = useAuth();
    const [view, setView] = useState('employees');

    if (loading) {
        return (
            <div
                className="login-screen"
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 24,
                    minHeight: '100vh',
                }}
            >
                <div className="skeleton-shimmer" style={{ width: 80, height: 80, borderRadius: 20 }} />
                <div className="skeleton-shimmer" style={{ width: 200, height: 24 }} />
                <div className="skeleton-shimmer" style={{ width: 140, height: 16 }} />
            </div>
        );
    }

    if (!user) {
        return <Login />;
    }

    const isAdmin = user.role === 'admin';
    const allowedViews = isAdmin ? [...PUBLIC_TABS, ...ADMIN_TABS] : PUBLIC_TABS;
    const activeView = allowedViews.includes(view) ? view : 'employees';

    return (
        <div className="app-shell">
            <div className="container">
                <NavTabs view={activeView} setView={setView} role={user.role} />
                {activeView === 'employees' && <EmployeesPage />}
                {activeView === 'users' && isAdmin && <UsersPage />}
                {activeView === 'audit' && isAdmin && <AuditPage />}
                {activeView === 'settings' && isAdmin && <SettingsPage />}
                {activeView === 'regulations' && <Regulations />}
                {activeView === 'auditCalc' && <LeaveCalculation />}
            </div>
            <footer className="footer">
                منظومة إجازات الموظفين الرقمية - مكتب أوقاف القره بوللي | تصميم وتطوير <span>عبدالرحيم أحمد شيتة</span> &copy; 2026
                <br />
                <span style={{ fontSize: '0.85em', opacity: 0.85 }}>النسخة 2.6</span>
            </footer>
        </div>
    );
}
