// Converts a YYYY-MM-DD date string (as stored/returned by the API) into
// the DD/MM/YYYY display format used throughout the Arabic UI.
export function formatDateDisplay(isoDate) {
    if (!isoDate) return '';
    const [year, month, day] = isoDate.split('-');
    if (!year || !month || !day) return isoDate;
    return `${day}/${month}/${year}`;
}
