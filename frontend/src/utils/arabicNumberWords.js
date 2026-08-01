// Arabic numerals → words, for the "بالحروف" fields on the printed leave
// request form. Covers 0–9999 plus a half-day fraction (e.g. 12.5), which is
// as far as leave balances ever go (accrual rates are 2.5 / 3.75 per month).

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر',
               'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة',
                  'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];
const THOUSANDS = ['', 'ألف', 'ألفان', 'ثلاثة آلاف', 'أربعة آلاف', 'خمسة آلاف',
                   'ستة آلاف', 'سبعة آلاف', 'ثمانية آلاف', 'تسعة آلاف'];

// Below 100. Arabic puts the unit before the ten: 21 → "واحد وعشرون".
function underHundred(n) {
    if (n < 10) return ONES[n];
    if (n < 20) return TEENS[n - 10];
    const ten = TENS[Math.floor(n / 10)];
    const one = ONES[n % 10];
    return one ? `${one} و${ten}` : ten;
}

function underThousand(n) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    if (!h) return underHundred(rest);
    if (!rest) return HUNDREDS[h];
    return `${HUNDREDS[h]} و${underHundred(rest)}`;
}

/**
 * @param {number} value  0–9999, optionally with a .5 fraction.
 * @returns {string} the number written out in Arabic, e.g. 15.5 → "خمسة عشر و نصف".
 */
export function numberToArabicWords(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return '';

    const whole = Math.floor(num);
    const hasHalf = Math.abs(num - whole - 0.5) < 0.01;

    let words;
    if (whole === 0) {
        words = hasHalf ? '' : 'صفر';
    } else if (whole < 1000) {
        words = underThousand(whole);
    } else {
        const th = Math.floor(whole / 1000);
        const rest = whole % 1000;
        words = th < 10 ? THOUSANDS[th] : `${underHundred(th)} ألفاً`;
        if (rest) words += ` و${underThousand(rest)}`;
    }

    if (hasHalf) words = words ? `${words} و نصف` : 'نصف';
    return words;
}

/**
 * Same as numberToArabicWords but with the counted noun attached, following
 * the Arabic rule that 1–2 use the singular/dual and 3+ take "يوماً".
 */
export function daysToArabicWords(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return '';
    if (num === 1) return 'يوم واحد';
    if (num === 2) return 'يومان';
    return `${numberToArabicWords(num)} يوماً`;
}
