import { useState } from 'react';

const CONFIRM_PHRASE = 'حذف الكل';

export default function ConfirmDangerModal({ title, message, onClose, onConfirm }) {
    const [typed, setTyped] = useState('');
    const [error, setError] = useState('');
    const [working, setWorking] = useState(false);

    const matches = typed.trim() === CONFIRM_PHRASE;

    async function handleConfirm() {
        if (!matches) return;
        setError('');
        setWorking(true);
        try {
            await onConfirm();
            onClose();
        } catch (err) {
            setError(err.message || 'تعذر تنفيذ العملية');
        } finally {
            setWorking(false);
        }
    }

    return (
        <div className="modal active">
            <div className="modal-content" style={{ maxWidth: 480, borderColor: 'rgba(239, 68, 68, 0.4)' }}>
                <div className="modal-header">
                    <h3 className="modal-title" style={{ color: 'var(--danger)' }}>
                        <i className="fas fa-triangle-exclamation"></i> {title}
                    </h3>
                    <button className="close-modal" onClick={onClose}>&times;</button>
                </div>

                <div className="form-error" style={{ marginBottom: '1.25rem' }}>{message}</div>

                {error && <div className="form-error">{error}</div>}

                <div className="form-group">
                    <label>
                        للتأكيد، يرجى كتابة العبارة التالية بالضبط: <strong style={{ color: 'var(--danger)' }}>{CONFIRM_PHRASE}</strong>
                    </label>
                    <input
                        type="text"
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        placeholder={CONFIRM_PHRASE}
                        autoFocus
                    />
                </div>

                <button
                    type="button"
                    className="btn btn-danger-outline"
                    style={{
                        width: '100%',
                        justifyContent: 'center',
                        background: matches ? 'var(--danger)' : undefined,
                        color: matches ? '#fff' : undefined,
                    }}
                    disabled={!matches || working}
                    onClick={handleConfirm}
                >
                    {working ? 'جاري الحذف...' : 'تأكيد الحذف النهائي'}
                </button>
            </div>
        </div>
    );
}
