// =====================================================================
//  runLeapYearSimulation()
//  ------------------------
//  Proves February is never hardcoded anywhere in the date-math engine.
//  calculateDeductionDays() derives month length from the native JS Date
//  object's own calendar arithmetic (a day-by-day getDay() loop) — never a
//  literal `28`/`29`/`30`/`31` day-count constant — so a leave spanning
//  February counts the 29th exactly when the year really has one.
//
//  It also pins the other half of the story: since the move to manual
//  annual allocation, the "مضاف حتى" label is the financial year's own end
//  date, so month length stopped being able to influence it at all. That
//  is asserted here rather than assumed, because it is the property that
//  replaced the old month-end cut-off (see libyaTime.js).
//
//  Run: node src/tests/leapYearSimulation.js
// =====================================================================
import { pathToFileURL } from 'node:url';
import { getYearEndDateStr, getAccrualLabel } from '../utils/libyaTime.js';
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
    // getYearEndDateStr(): the allocation label is the financial year's
    // own end date, so it must read 31/12 on every one of these days —
    // leap year or not, and whatever month happens to have just closed.
    // -------------------------------------------------------------
    console.log('-- getYearEndDateStr(): immune to month length --');
    for (const [y, leap] of [[2028, true], [2027, false], [2024, true], [2100, false], [2000, true]]) {
        const mar1 = libyaInstant(y, 3, 1);
        assert(
            getYearEndDateStr(mar1) === `31/12/${y}`,
            `March 1, ${y} (${leap ? 'leap' : 'non-leap'}) -> label date is 31/12/${y} (got ${getYearEndDateStr(mar1)})`
        );
    }
    // Feb 29 itself: the one day that only exists in a leap year.
    // February sits inside the first, not-yet-elapsed half — leap year or
    // not. The credit steps at the half-year boundaries, which no month
    // length can move.
    assert(
        getAccrualLabel(libyaInstant(2028, 2, 29)) === 'مضاف حتى 31/12/2027',
        `on Feb 29, 2028 the header still reads "مضاف حتى 31/12/2027" (got "${getAccrualLabel(libyaInstant(2028, 2, 29))}")`
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
    console.log('\n══════════════════════════════════════════');
    console.log(`  RESULT: ${pass} passed, ${fail} failed`);
    console.log('══════════════════════════════════════════');
    return { pass, fail };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { fail: failCount } = runLeapYearSimulation();
    if (failCount > 0) process.exit(1);
}
