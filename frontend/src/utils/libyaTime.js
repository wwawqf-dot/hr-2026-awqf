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

// ---- Annual allocation helpers (manual grant, no accrual) ----
//
// The system grants the FULL yearly entitlement up front, at the moment a
// financial year is opened (add_year) or an employee is created — it is a
// stored number on employee_years.added, not something recomputed from the
// clock. Nothing here derives a balance from "how many months have closed"
// any more; that monthly accrual engine (getAccruedDays/getAccruedMonths)
// was removed when the system moved to manual allocation.
//
// What remains time-dependent is only: which calendar year is "now", and
// the year-end date printed next to the allocation.
//
// Every helper below takes an OPTIONAL trailing `now` (a real Date instance)
// defaulting to `new Date()`, so production callers are unaffected — but a
// test can inject a simulated instant (e.g. "2027-01-15") and get back
// exactly what the live system would compute on that real date. This is
// the single source of "what time is it" for every function here: they all
// route through `getLibyaYearNum(now)` rather than each calling `new Date()`
// independently, so a simulated date can never partially apply.
function getLibyaYearNum(now = new Date()) {
    return Number(new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE, year: 'numeric',
    }).format(now));
}

export function getLibyaYear(now = new Date()) {
    return String(getLibyaYearNum(now));
}

// The last day of the CURRENT financial year, "31/12/yyyy". Kept for
// callers that genuinely mean the year boundary (year-end reporting,
// archive labels) rather than the period the current grant covers.
export function getYearEndDateStr(now = new Date()) {
    return `31/12/${getLibyaYearNum(now)}`;
}

// The end of the installment period the "مضاف" column is currently
// showing. The entitlement is released in two halves — 1 January and
// 1 July — so before July the stored figure genuinely covers only
// through 30 June, and labelling it "حتى 31/12" would overstate it by
// half a year. Both halves of this roll over on their own with Tripoli's
// calendar, so the label needs no maintenance at any year end.
export function getAllocationPeriodEndStr(now = new Date()) {
    const [year, month] = getLibyaDateStr(now).split('-');
    return Number(month) >= 7 ? `31/12/${year}` : `30/06/${year}`;
}

export function getAccrualLabel(now = new Date()) {
    return `مضاف حتى ${getAllocationPeriodEndStr(now)}`;
}
