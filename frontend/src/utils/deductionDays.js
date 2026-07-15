// Client-side preview mirror of the backend calculation. The backend is
// the source of truth and recalculates independently when the deduction
// is saved. "محفظ"/"محفظة" job titles observe a Thursday+Friday weekend;
// every other job title uses the standard Friday+Saturday weekend.
export function getWeekendDays(jobTitle) {
    const isHafiz = jobTitle === 'محفظ' || jobTitle === 'محفظة';
    return isHafiz ? [4, 5] : [5, 6];
}

// Parses 'YYYY-MM-DD' as LOCAL midnight (not UTC) so weekday detection and
// day counting never shift by a day on non-positive timezones. Mirrors the
// backend helper of the same name.
function parseLocalDate(str) {
    if (!str || typeof str !== 'string') return null;
    const parts = str.split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    const [y, m, d] = parts;
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

export function calculateDeductionDays(startStr, endStr, customHolidays = 0, jobTitle = '') {
    if (!startStr || !endStr) return 0;
    const start = parseLocalDate(startStr);
    const end = parseLocalDate(endStr);
    if (!start || !end || end < start) return 0;

    const weekendDays = getWeekendDays(jobTitle);

    let actualDays = 0;
    const current = new Date(start);
    while (current <= end) {
        const day = current.getDay();
        if (!weekendDays.includes(day)) actualDays++;
        current.setDate(current.getDate() + 1);
    }
    const holidays = Number(customHolidays) || 0;
    return Math.max(0, actualDays - holidays);
}
