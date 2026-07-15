import PageHeader from './PageHeader';

export default function Regulations() {
    return (
        <>
            <PageHeader />

            <div className="panel">
                <h2><i className="fas fa-book"></i> اللوائح التنظيمية ودليل الاستخدام</h2>
                <p style={{ color: 'var(--text-muted)', lineHeight: 1.9 }}>
                    سيتم إضافة لوائح العمل، وطريقة حساب الإجازات، ودليل استخدام المنظومة هنا قريباً...
                </p>
            </div>
        </>
    );
}
