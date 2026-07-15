const TIMEZONE = 'Africa/Tripoli';

// Returns a Date object set to the current exact time in Libya, immune to
// the user's OS/browser timezone or clock tampering (relies on the IANA
// timezone database embedded in the browser's Intl engine).
export function getLibyaTime() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type).value;
    return new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`);
}

// Returns today's date in Libya as a YYYY-MM-DD string.
export function getLibyaDateStr() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}

// Returns the current year number in Libya.
export function getLibyaYear() {
    return new Intl.DateTimeFormat('en', { timeZone: TIMEZONE, year: 'numeric' }).format(new Date());
}
