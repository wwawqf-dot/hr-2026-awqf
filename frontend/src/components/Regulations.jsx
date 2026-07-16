import PageHeader from './PageHeader';
import UserGuide from './UserGuide';

export default function Regulations() {
    return (
        <>
            <PageHeader />
            <UserGuide />
            <div
                className="regulations-card"
                style={{
                    marginTop: '1.25rem',
                    padding: '1.5rem',
                    borderRadius: 12,
                    background: 'rgba(245, 158, 11, 0.04)',
                    border: '1px solid rgba(245, 158, 11, 0.2)',
                    borderRight: '4px solid #f59e0b',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <i className="fas fa-gavel" style={{ color: '#f59e0b', fontSize: '1.3rem' }}></i>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f59e0b' }}>
                        قوانين الإجازات المعمول بها
                    </h3>
                </div>
                <p style={{ margin: 0, color: 'var(--text-muted, #94a3b8)', fontSize: '0.92rem' }}>
                    سيتم إدراج اللوائح القانونية لاحقاً.
                </p>
            </div>
        </>
    );
}
