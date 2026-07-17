// Mirrors the front-end calculation: counts calendar days between
// start and end (inclusive), excluding the weekend days based on the
// employee's memorizer status.
// Regular employees (isMemorizer=false): skip Thu(4)+Fri(5).
// Memorizers (isMemorizer=true): skip Fri(5)+Sat(6).
function getWeekendDays(isMemorizer) {
    return isMemorizer ? [5, 6] : [4, 5];
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

function calculateDeductionDays(startStr, endStr, customHolidays = 0, isMemorizer = false) {
    if (!startStr || !endStr) return 0;
    const start = parseLocalDate(startStr);
    const end = parseLocalDate(endStr);
    if (!start || !end || end < start) return 0;

    const weekendDays = getWeekendDays(isMemorizer);

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
