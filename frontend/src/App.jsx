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

export default function App() {
    const { user, loading } = useAuth();
    const [view, setView] = useState('employees');

    if (loading) {
        return (
            <div className="login-screen">
                <p style={{ color: 'var(--text-muted)' }}>جاري التحميل...</p>
            </div>
        );
    }

    if (!user) {
        return <Login />;
    }

    const activeView = user.role === 'admin' ? view : 'employees';

    return (
        <div className="app-shell">
            <div className="container">
                {user.role === 'admin' && <NavTabs view={activeView} setView={setView} />}
                {activeView === 'employees' && <EmployeesPage />}
                {activeView === 'users' && <UsersPage />}
                {activeView === 'audit' && <AuditPage />}
                {activeView === 'settings' && <SettingsPage />}
                {activeView === 'regulations' && <Regulations />}
                {activeView === 'auditCalc' && <LeaveCalculation />}
            </div>
            <footer className="footer">
                منظومة إجازات الموظفين الرقمية - مكتب أوقاف القره بوللي | تصميم وتطوير <span>عبدالرحيم أحمد شيتة</span> &copy; 2026
                <br />
                <span style={{ fontSize: '0.85em', opacity: 0.85 }}>النسخة 1.1</span>
            </footer>
        </div>
    );
}
