import { useMemo } from 'react';

function SkeletonBox({ width, height, style, rounded = true }) {
    return (
        <div
            className="skeleton-shimmer"
            style={{
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

export function CardSkeleton({ lines = 3, height = 140 }) {
    return (
        <div
            className="panel"
            style={{ padding: '1.25rem', height, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }}
        >
            <SkeletonBox width="55%" height={22} />
            {Array.from({ length: lines }).map((_, i) => (
                <SkeletonBox key={i} width={`${60 + Math.random() * 30}%`} height={16} />
            ))}
        </div>
    );
}

export function TextSkeleton({ lines = 4 }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: lines }).map((_, i) => (
                <SkeletonBox
                    key={i}
                    width={i === lines - 1 ? '50%' : '100%'}
                    height={16}
                />
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

export function AuthSkeleton() {
    return (
        <div
            className="login-screen"
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 24,
                minHeight: '100vh',
            }}
        >
            <SkeletonBox width={80} height={80} style={{ borderRadius: 20 }} />
            <SkeletonBox width={200} height={24} />
            <SkeletonBox width={140} height={16} />
        </div>
    );
}

export default function SkeletonLoader({ variant = 'table', rows, cols, lines, height }) {
    switch (variant) {
        case 'table':
            return <TableSkeleton rows={rows} cols={cols} />;
        case 'card':
            return <CardSkeleton lines={lines} height={height} />;
        case 'text':
            return <TextSkeleton lines={lines} />;
        case 'widget':
            return <WidgetSkeleton />;
        case 'auth':
            return <AuthSkeleton />;
        default:
            return <TextSkeleton lines={3} />;
    }
}
