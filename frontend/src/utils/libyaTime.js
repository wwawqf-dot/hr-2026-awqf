const TIMEZONE = 'Africa/Tripoli';

export function getLibyaTime(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type).value;
    return new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`);
}

export function getLibyaDateStr(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}

// ---- Dynamic accrual helpers (no cron jobs) ----
//
// Every helper below takes an OPTIONAL trailing `now` (a real Date instance)
// defaulting to `new Date()`, so production callers are unaffected — but a
// test can inject a simulated instant (e.g. "2027-01-15") and get back
// exactly what the live system would compute on that real date. This is
// the single source of "what time is it" for every function here: they all
// route through `getLibyaFields(now)` rather than each calling `new Date()`
// independently, so a simulated date can never partially apply.
function getLibyaFields(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type).value;
    return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')) };
}

export function getLibyaYear(now = new Date()) {
    return String(getLibyaFields(now).year);
}

// Completed months of `year` as of `now`. Past years are always fully
// accrued (12); future years have accrued nothing (0); the active year
// accrues one month per calendar month already CLOSED (month - 1, so the
// still-in-progress current month never counts until it ends).
export function getAccruedMonths(year, now = new Date()) {
    const { year: ly, month } = getLibyaFields(now);
    const targetYear = year == null ? ly : Number(year);
    if (targetYear < ly) return 12;
    if (targetYear > ly) return 0;
    return Math.max(0, month - 1);
}

export function getLastDayPrevMonthStr(now = new Date()) {
    const { year, month } = getLibyaFields(now);
    const d = new Date(year, month - 1, 1);
    d.setDate(0);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

export function getAccrualLabel(now = new Date()) {
    return `مضاف حتى ${getLastDayPrevMonthStr(now)}`;
}

// Days accrued for `year` as of `now`: completed months × the age-based
// monthly rate (2.5 => max 30/yr, 3.75 => max 45/yr), with the 15th-day
// hire-date rule applied only when `year` is the currently active year.
export function getAccruedDays(year, monthlyRate = 2.5, hireDateCurrentYear = null, now = new Date()) {
    const targetYear = Number(year);
    const { year: currentYear, month: currentMonth } = getLibyaFields(now);

    if (hireDateCurrentYear && targetYear === currentYear) {
        const cutoffMonth = currentMonth - 1;
        const [, hireMonthStr, hireDayStr] = hireDateCurrentYear.split('-');
        const hireMonth = Number(hireMonthStr);
        const hireDay = Number(hireDayStr);
        if (hireMonth > cutoffMonth) return 0;
        const firstMonth = hireDay > 15 ? hireMonth + 1 : hireMonth;
        if (firstMonth > cutoffMonth) return 0;
        const months = cutoffMonth - firstMonth + 1;
        // toFixed(2), not (1): the 45-day track's 3.75/month rate needs two
        // decimal places (3.75, 7.5, 11.25, ...) — rounding to one decimal
        // silently mangles 3.75 into 3.8.
        return +(months * monthlyRate).toFixed(2);
    }
    return +(getAccruedMonths(targetYear, now) * monthlyRate).toFixed(2);
}
