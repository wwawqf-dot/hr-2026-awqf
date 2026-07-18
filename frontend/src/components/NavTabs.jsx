import { useState } from 'react';

const ALL_TABS = [
    { key: 'employees', label: 'الموظفون', icon: 'fa-users', roles: ['admin', 'data_entry', 'viewer'] },
    { key: 'users', label: 'إدارة المستخدمين', icon: 'fa-user-shield', roles: ['admin'] },
    { key: 'activity', label: 'سجل النشاطات', icon: 'fa-shield-alt', roles: ['admin'] },
    { key: 'audit', label: 'سجل المراجعة', icon: 'fa-clipboard-list', roles: ['admin'] },
    { key: 'settings', label: 'أساسيات النظام', icon: 'fa-sliders-h', roles: ['admin'] },
];

export default function NavTabs({ view, setView, role }) {
    const tabs = ALL_TABS.filter((t) => t.roles.includes(role));
    const [open, setOpen] = useState(false);
    const activeTab = tabs.find((t) => t.key === view);

    function selectTab(key) {
        setView(key);
        setOpen(false);
    }

    return (
        <div className="nav-tabs-wrap">
            <button type="button" className="nav-tabs-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                <span><i className={`fas ${activeTab?.icon || 'fa-bars'}`}></i> {activeTab?.label || 'القائمة'}</span>
                <i className={`fas ${open ? 'fa-xmark' : 'fa-bars'}`}></i>
            </button>
            <div className={`nav-tabs${open ? ' nav-tabs-open' : ''}`}>
                {tabs.map((tab) => (
                    <button key={tab.key} className={`nav-tab${view === tab.key ? ' active' : ''}`}
                        onClick={() => selectTab(tab.key)}>
                        <i className={`fas ${tab.icon}`}></i> {tab.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
