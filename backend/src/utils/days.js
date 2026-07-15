// Mirrors the original front-end calculation: counts calendar days between
// start and end (inclusive), excluding the weekend days that apply to the
// employee's job title, then subtracts any custom holiday days that fall
// within the range.
//
// "محفظ" / "محفظة" (Quran memorization instructors) observe a Thursday +
// Friday weekend; every other job title uses the standard Friday +
// Saturday weekend.
function getWeekendDays(jobTitle) {
    const isHafiz = jobTitle === 'محفظ' || jobTitle === 'محفظة';
    return isHafiz ? [4, 5] : [5, 6];
}

// Parses a 'YYYY-MM-DD' string into a LOCAL-midnight Date. Using
// `new Date('YYYY-MM-DD')` would parse as UTC midnight, and the later
// .getDay()/.getDate() calls read local time — shifting the weekday by a
// day in any non-positive timezone. Building from components avoids that
// entirely, so day counts stay correct on any machine.
function parseLocalDate(str) {
    if (!str || typeof str !== 'string') return null;
    const parts = str.split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    const [y, m, d] = parts;
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function calculateDeductionDays(startStr, endStr, customHolidays = 0, jobTitle = '') {
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

module.exports = { calculateDeductionDays, getWeekendDays };
