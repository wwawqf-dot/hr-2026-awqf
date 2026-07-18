import { useEffect, useState } from 'react';
import { getLibyaDisplayDate, getLibyaDisplayTime } from '../utils/libyaTime';

// Live, auto-advancing clock showing Libya time. Ticks every second.
// Tracks the REAL instant (`new Date()`) and formats it directly with a
// single Tripoli conversion — never through getLibyaTime(), whose return
// value must not be re-formatted with an explicit timeZone (see
// libyaTime.js). That exact mistake previously made this clock show the
// wrong time (and, near midnight, the wrong date) on any machine whose
// own local zone wasn't already Africa/Tripoli.
export default function LiveClock() {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
    }, []);

    const dateStr = getLibyaDisplayDate(now, { weekday: 'long' });
    const timeStr = getLibyaDisplayTime(now);

    return (
        <div className="live-clock" title="التاريخ والوقت الحالي للنظام">
            <i className="fas fa-clock"></i>
            <span className="live-clock-date">{dateStr}</span>
            <span className="live-clock-time">{timeStr}</span>
        </div>
    );
}
