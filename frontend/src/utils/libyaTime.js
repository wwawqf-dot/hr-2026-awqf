const TIMEZONE = 'Africa/Tripoli';

export function getLibyaTime() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type).value;
    return new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`);
}

export function getLibyaDateStr() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}

export function getLibyaYear() {
    return new Intl.DateTimeFormat('en', { timeZone: TIMEZONE, year: 'numeric' }).format(new Date());
}

// ---- Dynamic accrual helpers (no cron jobs) ----

function getLibyaFields() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type).value;
    return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')) };
}

export function getAccruedMonths(year) {
    const { year: ly, month } = getLibyaFields();
    if (year == null) year = ly;
    if (year < ly) return 12;
    if (year > ly) return 0;
    return Math.max(0, month - 1);
}

export function getLastDayPrevMonthStr() {
    const { year, month } = getLibyaFields();
    const d = new Date(year, month - 1, 1);
    d.setDate(0);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

export function getAccrualLabel() {
    return `مضاف حتى ${getLastDayPrevMonthStr()}`;
}

export function getAccruedDays(year, monthlyRate = 2.5) {
    return +(getAccruedMonths(year) * monthlyRate).toFixed(1);
}
