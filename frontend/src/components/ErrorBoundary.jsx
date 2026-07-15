import { Component } from 'react';

// Catches any render-time error anywhere below it so a single component
// bug can never white-screen the whole system. Shows a clean Arabic
// message with a reload action instead of a blank page.
export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, message: '' };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, message: (error && error.message) || '' };
    }

    componentDidCatch(error, info) {
        // Kept for local diagnostics; never leaves the machine.
        console.error('واجهة النظام واجهت خطأ غير متوقع:', error, info);
    }

    handleReload = () => {
        window.location.reload();
    };

    render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <div
                style={{
                    minHeight: '100vh',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '1.25rem',
                    padding: '2rem',
                    textAlign: 'center',
                    fontFamily: "'Tajawal', sans-serif",
                }}
            >
                <div style={{ fontSize: '3rem', color: '#f59e0b' }}>
                    <i className="fas fa-triangle-exclamation"></i>
                </div>
                <h2 style={{ margin: 0, color: 'var(--text-main, #fff)' }}>
                    حدث خطأ غير متوقع في الواجهة
                </h2>
                <p style={{ margin: 0, color: 'var(--text-muted, #94a3b8)', maxWidth: 480 }}>
                    لم تُفقد أي بيانات. يرجى إعادة تحميل الصفحة للمتابعة. إذا تكرر الخطأ،
                    أعد تشغيل النظام عبر ملف <code>start.bat</code>.
                </p>
                <button
                    type="button"
                    className="btn btn-primary"
                    onClick={this.handleReload}
                    style={{ padding: '0.7rem 1.4rem', fontSize: '1rem' }}
                >
                    <i className="fas fa-rotate-right"></i> إعادة تحميل الصفحة
                </button>
            </div>
        );
    }
}
