import PageHeader from './PageHeader';
import UserGuide from './UserGuide';

export default function Regulations() {
    return (
        <>
            <PageHeader />

            <div className="regulations-grid">
                <div className="regulations-card">
                    <div className="regulations-card-icon">
                        <i className="fas fa-book-open"></i>
                    </div>
                    <h3>دليل استخدام المنظومة</h3>
                    <UserGuide />
                </div>

                <div
                    className="regulations-card"
                    style={{
                        '--card-accent': 'var(--warning)',
                        '--card-accent-alpha': 'rgba(245, 158, 11, 0.12)',
                        '--card-accent-border': 'rgba(245, 158, 11, 0.3)',
                    }}
                >
                    <div className="regulations-card-icon">
                        <i className="fas fa-gavel"></i>
                    </div>
                    <h3>قوانين الإجازات المعمول بها</h3>
                    <p>سيتم إضافة القوانين واللوائح الرسمية للإجازات المعمول بها في الدولة قريباً...</p>
                </div>
            </div>
        </>
    );
}
