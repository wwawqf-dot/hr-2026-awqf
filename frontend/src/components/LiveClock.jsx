import { useEffect, useState } from 'react';
import { getLibyaTime } from '../utils/libyaTime';

// Live, auto-advancing clock showing Libya time. Ticks every second.
export default function LiveClock() {
    const [now, setNow] = useState(getLibyaTime);

    useEffect(() => {
        const id = setInterval(() => setNow(getLibyaTime()), 1000);
        return () => clearInterval(id);
    }, []);

    const dateStr = now.toLocaleDateString('ar-LY', {
        timeZone: 'Africa/Tripoli',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    const timeStr = now.toLocaleTimeString('ar-LY', {
        timeZone: 'Africa/Tripoli',
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
