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

// ---- Display formatters — the ONLY correct way to render "now" ----
//
// getLibyaTime() returns Tripoli's wall-clock numbers re-encoded as a
// Date the JS engine treats as if it were in the BROWSER's own local zone
// (a deliberate trick so that plain, timezone-less getters/setters like
// .getDate()/.setDate() on its result behave correctly). That means its
// return value must NEVER be formatted with an explicit `timeZone` option
// again — doing so converts it a SECOND time and shifts the display by
// whatever the difference is between Tripoli's offset and the viewer's
// real browser offset. This is not theoretical: it was found and proven
// to flip the printed "تاريخ الإصدار" to the wrong calendar day whenever
// the admin's own machine is in a different zone than Tripoli, and it
// silently mis-showed the header's live clock the same way on every page.
//
// These two functions are the fix: they take a REAL instant (the actual
// `now`, not a pre-converted one) and do exactly one Tripoli conversion,
// via Intl directly. Every place that displays "the current Libya date/
// time" — the header clock, print report issue dates — must go through
// these, never through getLibyaTime().toLocaleDateString(...).
export function getLibyaDisplayDate(now = new Date(), options = {}) {
    return new Intl.DateTimeFormat('ar-LY', {
        timeZone: TIMEZONE, year: 'numeric', month: 'long', day: 'numeric', ...options,
    }).format(now);
}

export function getLibyaDisplayTime(now = new Date(), options = {}) {
    return new Intl.DateTimeFormat('ar-LY', {
        timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', ...options,
    }).format(now);
}

// For a genuine stored moment-in-time (a `timestamptz` column value, e.g.
// audit_log.timestamp or a user's created_at) — always display it in
// Tripoli's zone regardless of the viewing admin's own machine timezone,
// so every admin sees the exact same wall-clock time for the same event.
export function formatLibyaTimestamp(value, options = {}) {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('ar-LY', {
        timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', ...options,
    }).format(d);
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
