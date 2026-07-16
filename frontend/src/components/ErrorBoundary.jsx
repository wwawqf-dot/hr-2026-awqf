import { Component } from 'react';

export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, info) {
        console.error('[ErrorBoundary]', error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    minHeight: '100vh',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#0b0f19',
                    color: '#f3f4f6',
                    fontFamily: "'Tajawal', sans-serif",
                    padding: '2rem',
                    textAlign: 'center',
                }}>
                    <div style={{
                        width: 64, height: 64, borderRadius: 16,
                        background: 'rgba(239,68,68,0.1)',
                        border: '1px solid rgba(239,68,68,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.8rem', marginBottom: '1.25rem', color: '#ef4444',
                    }}>
                        <i className="fas fa-exclamation-triangle"></i>
                    </div>
                    <h1 style={{ color: '#ef4444', fontSize: '1.4rem', fontWeight: 800, marginBottom: '0.6rem' }}>
                        عذراً، حدث خطأ غير متوقع
                    </h1>
                    <p style={{ color: '#9ca3af', fontSize: '0.9rem', maxWidth: 420, lineHeight: 1.8, marginBottom: '1.5rem' }}>
                        واجه التطبيق خطأ أثناء التحميل. يرجى إعادة تحميل الصفحة. إذا استمرت المشكلة، تواصل مع مدير النظام.
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            background: '#10b981', color: '#fff', border: 'none',
                            padding: '0.8rem 2rem', borderRadius: 10, cursor: 'pointer',
                            fontSize: '1rem', fontWeight: 700,
                            boxShadow: '0 4px 15px rgba(16,185,129,0.25)',
                        }}
                    >
                        <i className="fas fa-sync-alt" style={{ marginLeft: 8 }}></i>
                        إعادة تحميل الصفحة
                    </button>
                    <details style={{ marginTop: '2rem', color: '#6b7280', fontSize: '0.78rem', maxWidth: 500 }}>
                        <summary style={{ cursor: 'pointer', color: '#9ca3af' }}>تفاصيل تقنية</summary>
                        <pre style={{ marginTop: '0.6rem', textAlign: 'left', direction: 'ltr', background: 'rgba(0,0,0,0.3)', padding: '0.8rem', borderRadius: 8, overflow: 'auto', fontSize: '0.75rem', lineHeight: 1.5 }}>
                            {this.state.error?.message || 'خطأ غير معروف'}
                            {'\n'}
                            {this.state.error?.stack || ''}
                        </pre>
                    </details>
                </div>
            );
        }
        return this.props.children;
    }
}
