// Themed replacement for native window.confirm() — no "localhost says…" chrome.
// Reuses the app's existing glassmorphism modal classes so it matches every
// other dialog. Stacks above other open modals via a higher z-index.
export default function CustomConfirmModal({
    title = 'تأكيد العملية',
    message,
    confirmLabel = 'نعم، متأكد',
    cancelLabel = 'إلغاء',
    onConfirm,
    onCancel,
    danger = true,
    busy = false,
}) {
    return (
        <div className="modal active" style={{ zIndex: 3000 }} onClick={onCancel}>
            <div
                className="modal-content"
                style={{ maxWidth: 460 }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h3 className="modal-title">
                        <i
                            className="fas fa-triangle-exclamation"
                            style={{ color: danger ? '#ef4444' : '#f59e0b', marginLeft: 8 }}
                        ></i>
                        {title}
                    </h3>
                    <button className="close-modal" onClick={onCancel}>&times;</button>
                </div>

                <p style={{ color: 'var(--text-main)', lineHeight: 1.9, margin: '0.25rem 0 1.5rem', whiteSpace: 'pre-line' }}>
                    {message}
                </p>

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        className={danger ? 'btn btn-danger' : 'btn btn-primary'}
                        onClick={onConfirm}
                        disabled={busy}
                    >
                        {busy ? 'جاري التنفيذ...' : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
