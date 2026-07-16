export default function LoadingSpinner({ size = 18, color = '#10b981', style }) {
    return (
        <span
            className="loading-spinner"
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: size,
                height: size,
                ...style,
            }}
        >
            <svg
                viewBox="0 0 24 24"
                fill="none"
                style={{
                    width: size,
                    height: size,
                    animation: 'spin 0.8s linear infinite',
                }}
            >
                <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke={color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray="31.4 31.4"
                    strokeDashoffset="0"
                    opacity="0.25"
                />
                <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke={color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray="31.4 31.4"
                    strokeDashoffset="8"
                    opacity="0.9"
                    style={{ transformOrigin: 'center', transform: 'rotate(-90deg)' }}
                />
            </svg>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </span>
    );
}
