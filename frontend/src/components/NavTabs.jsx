const TABS = [
    { key: 'employees', label: 'الموظفون', icon: 'fa-users' },
    { key: 'users', label: 'إدارة المستخدمين', icon: 'fa-user-shield' },
    { key: 'audit', label: 'سجل النشاطات', icon: 'fa-clipboard-list' },
    { key: 'settings', label: 'أساسيات النظام', icon: 'fa-sliders-h' },
    { key: 'regulations', label: 'اللوائح التنظيمية', icon: 'fa-book' },
];

export default function NavTabs({ view, setView }) {
    return (
        <div className="nav-tabs">
            {TABS.map((tab) => (
                <button
                    key={tab.key}
                    className={`nav-tab${view === tab.key ? ' active' : ''}`}
                    onClick={() => setView(tab.key)}
                >
                    <i className={`fas ${tab.icon}`}></i> {tab.label}
                </button>
            ))}
        </div>
    );
}
