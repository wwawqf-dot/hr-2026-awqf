import { useEffect, useState } from 'react';

// Live, auto-advancing clock driven by the machine's real time. Ticks every
// second and clears its interval on unmount (no memory leak). This is the
// system's "current today" — the frozen virtual date has been retired.
export default function LiveClock() {
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
    }, []);

    const dateStr = now.toLocaleDateString('ar-LY', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    const timeStr = now.toLocaleTimeString('ar-LY', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });

    return (
        <div className="live-clock" title="التاريخ والوقت الحالي للنظام">
            <i className="fas fa-clock"></i>
            <span className="live-clock-date">{dateStr}</span>
            <span className="live-clock-time">{timeStr}</span>
        </div>
    );
}
