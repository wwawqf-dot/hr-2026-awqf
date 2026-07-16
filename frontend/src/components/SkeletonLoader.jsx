import { useMemo } from 'react';

const boxStyle = {
    background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.5s ease-in-out infinite',
};

function SkeletonBox({ width, height, style, rounded = true }) {
    return (
        <div
            className="skeleton-shimmer"
            style={{
                ...boxStyle,
                width: width || '100%',
                height: height || 20,
                borderRadius: rounded ? 8 : 4,
                ...style,
            }}
        />
    );
}

export function TableSkeleton({ rows = 6, cols = 7 }) {
    const colWidths = useMemo(() => {
        const widths = [];
        for (let i = 0; i < cols; i++) {
            widths.push(60 + Math.random() * 25);
        }
        return widths;
    }, [cols]);

    return (
        <div style={{ padding: '1.25rem' }}>
            {Array.from({ length: rows }).map((_, r) => (
                <div
                    key={r}
                    style={{
                        display: 'flex',
                        gap: 12,
                        padding: '0.9rem 0',
                        borderBottom: r < rows - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                        alignItems: 'center',
                    }}
                >
                    {colWidths.map((w, c) => (
                        <SkeletonBox
                            key={c}
                            width={`${w}%`}
                            height={18}
                            style={{ flex: c === 0 ? 0 : 1, minWidth: c === 0 ? 50 : 0 }}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}

export function WidgetSkeleton() {
    return (
        <div
            className="panel"
            style={{
                padding: '1rem 1.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                direction: 'rtl',
            }}
        >
            <SkeletonBox width={36} height={36} rounded />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SkeletonBox width="40%" height={16} />
                <SkeletonBox width="25%" height={14} />
            </div>
        </div>
    );
}


