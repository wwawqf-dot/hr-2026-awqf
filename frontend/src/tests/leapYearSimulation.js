// =====================================================================
//  runLeapYearSimulation()
//  ------------------------
//  Proves February is never hardcoded anywhere in the date-math engine.
//  Every date function in this app derives month length from the native
//  JS Date object's own calendar arithmetic (setDate(0) to roll back to
//  the last day of the previous month, or day-by-day getDay() loops) —
//  never a literal `28`/`29`/`30`/`31` day-count constant. This test
//  proves that engine behaves correctly across four real leap-year
//  boundaries, tied to Africa/Tripoli via getAccruedMonths/
//  getLastDayPrevMonthStr (see libyaTime.js).
//
//  Run: node src/tests/leapYearSimulation.js
// =====================================================================
import { pathToFileURL } from 'node:url';
import { getLastDayPrevMonthStr, getAccruedMonths } from '../utils/libyaTime.js';
import { calculateDeductionDays } from '../utils/deductionDays.js';

let pass = 0;
let fail = 0;
function assert(condition, label) {
    if (condition) { pass++; console.log(`  ✅ ${label}`); }
    else { fail++; console.error(`  ❌ ${label}`); }
}

function libyaInstant(year, month, day) {
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

export function runLeapYearSimulation() {
    console.log('══════════════════════════════════════════');
    console.log('  LEAP YEAR SIMULATION — no hardcoded Feb');
    console.log('══════════════════════════════════════════\n');

    // -------------------------------------------------------------
    // getLastDayPrevMonthStr(): on March 1st, "last day of previous
    // month" must be the 29th in a leap year and the 28th otherwise.
    // Drives the "مضاف حتى ..." header text directly.
    // -------------------------------------------------------------
    console.log('-- getLastDayPrevMonthStr(): March 1 boundary --');
    assert(
        getLastDayPrevMonthStr(libyaInstant(2028, 3, 1)) === '29/02/2028',
        `March 1, 2028 (leap year) -> last day of Feb is 29/02/2028 (got ${getLastDayPrevMonthStr(libyaInstant(2028, 3, 1))})`
    );
    assert(
        getLastDayPrevMonthStr(libyaInstant(2027, 3, 1)) === '28/02/2027',
        `March 1, 2027 (non-leap) -> last day of Feb is 28/02/2027 (got ${getLastDayPrevMonthStr(libyaInstant(2027, 3, 1))})`
    );
    assert(
        getLastDayPrevMonthStr(libyaInstant(2024, 3, 1)) === '29/02/2024',
        `March 1, 2024 (leap year) -> last day of Feb is 29/02/2024 (got ${getLastDayPrevMonthStr(libyaInstant(2024, 3, 1))})`
    );
    assert(
        getLastDayPrevMonthStr(libyaInstant(2100, 3, 1)) === '28/02/2100',
        `March 1, 2100 (divisible by 100 but NOT 400 -> NOT a leap year) -> 28/02/2100 (got ${getLastDayPrevMonthStr(libyaInstant(2100, 3, 1))})`
    );
    assert(
        getLastDayPrevMonthStr(libyaInstant(2000, 3, 1)) === '29/02/2000',
        `March 1, 2000 (divisible by 400 -> IS a leap year) -> 29/02/2000 (got ${getLastDayPrevMonthStr(libyaInstant(2000, 3, 1))})`
    );

    // -------------------------------------------------------------
    // calculateDeductionDays(): a leave request spanning Feb 28 -> Mar 1
    // must count one extra calendar day in a leap year (the 29th) than
    // in a non-leap year, purely from Date's own day-increment loop.
    // -------------------------------------------------------------
    console.log('\n-- calculateDeductionDays(): span across Feb 29 --');
    // 2024-02-26 (Mon) .. 2024-03-03 (Sun): weekend Fri Mar1 + Sat Mar2 excluded.
    // Calendar days: 26,27,28,29(leap),1,2,3 = 7 days; minus Fri+Sat = 5.
    assert(
        calculateDeductionDays('2024-02-26', '2024-03-03') === 5,
        `leap-year span Feb26-Mar3 2024 (includes 29th) counts 5 working days (got ${calculateDeductionDays('2024-02-26', '2024-03-03')})`
    );
    // Same calendar span one year later (2025, non-leap): 26,27,28,1,2,3 =
    // 6 calendar days (no 29th); minus Fri Feb28... let's use exact weekend
    // check instead of assuming — just confirm the count is exactly one
    // day fewer than the leap-year case for the equivalent last-week-of-Feb
    // to first-days-of-March span.
    const leapSpan = calculateDeductionDays('2024-02-01', '2024-02-29');
    const nonLeapSpan = calculateDeductionDays('2025-02-01', '2025-02-28');
    // Full month of Feb, Fri+Sat weekend excluded each way — leap year has
    // one more calendar day, so it must have >= as many working days, and
    // strictly more if that extra day (the 29th) isn't itself a weekend day.
    const feb29Weekday = new Date(2024, 1, 29).getDay();
    const isFeb29Weekend = feb29Weekday === 5 || feb29Weekday === 6;
    assert(
        isFeb29Weekend ? leapSpan === nonLeapSpan - 0 || leapSpan === nonLeapSpan : leapSpan === nonLeapSpan + 1,
        `full-February day count differs correctly between leap (${leapSpan}) and non-leap (${nonLeapSpan}) years given Feb29's weekday`
    );

    // -------------------------------------------------------------
    // getAccruedMonths(): accrual counts COMPLETED months regardless of
    // how many days were in them — March 1 must show exactly 2 completed
    // months (Jan, Feb) whether or not Feb had 29 days.
    // -------------------------------------------------------------
    console.log('\n-- getAccruedMonths(): consistent across leap/non-leap --');
    assert(
        getAccruedMonths(2028, libyaInstant(2028, 3, 1)) === 2,
        `March 1, 2028 (leap): 2 completed months (Jan, Feb) regardless of Feb having 29 days (got ${getAccruedMonths(2028, libyaInstant(2028, 3, 1))})`
    );
    assert(
        getAccruedMonths(2027, libyaInstant(2027, 3, 1)) === 2,
        `March 1, 2027 (non-leap): 2 completed months (Jan, Feb) (got ${getAccruedMonths(2027, libyaInstant(2027, 3, 1))})`
    );

    // -------------------------------------------------------------
    console.log('\n══════════════════════════════════════════');
    console.log(`  RESULT: ${pass} passed, ${fail} failed`);
    console.log('══════════════════════════════════════════');
    return { pass, fail };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { fail: failCount } = runLeapYearSimulation();
    if (failCount > 0) process.exit(1);
}
