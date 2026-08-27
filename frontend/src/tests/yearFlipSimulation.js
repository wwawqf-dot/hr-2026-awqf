// =====================================================================
//  runYearFlipSimulation()
//  -----------------------
//  Verifies the manual-allocation engine's behavior across the
//  2026 -> 2027 financial year flip, using REAL production code
//  (libyaTime.js / leaveCalc.js) with a mocked `now` — not a
//  reimplementation of the math, so a real bug in the engine cannot hide
//  behind a parallel "test copy" of the same formula.
//
//  The invariant under test since the move off monthly accrual: the year's
//  days are granted ONCE, in full, when the year is opened — the displayed
//  figure must therefore be identical on 1 January and on 31 December, and
//  the "مضاف حتى" label must read that year's own end date (31/12).
//
//  Run from Node (no browser/session needed — pure date/math logic):
//    node src/tests/yearFlipSimulation.js
//
//  Or from the browser console:
//    import('/src/tests/yearFlipSimulation.js').then(m => m.runYearFlipSimulation())
// =====================================================================
import { pathToFileURL } from 'node:url';
import { getAccrualLabel, getYearEndDateStr, getAllocationPeriodEndStr } from '../utils/libyaTime.js';
import { computeYearlyLedger } from '../utils/leaveCalc.js';

let pass = 0;
let fail = 0;
function assert(condition, label) {
    if (condition) { pass++; console.log(`  ✅ ${label}`); }
    else { fail++; console.error(`  ❌ ${label}`); }
}

// A Date representing a specific Libya wall-clock instant. Built at local
// noon so it can never drift into a neighboring UTC day regardless of the
// machine's own timezone (mirrors how the app's real getLibyaTime() is
// timezone-proof, but here we just need a stable calendar day to inject).
function libyaInstant(year, month, day) {
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

export function runYearFlipSimulation() {
    console.log('══════════════════════════════════════════');
    console.log('  YEAR-FLIP SIMULATION — 2026 -> 2027');
    console.log('══════════════════════════════════════════\n');

    // A representative employee: standard 30-day track, carried a real
    // balance out of 2025, with 2026 fully closed (stored, historical).
    const employee = {
        id: 1,
        name: 'Test Employee',
        over_45: false,
        is_unpaid_leave: false,
        hire_date_current_year: null,
        initial_carried_forward: 12, // pre-digital carry-in
        years_data: {
            2025: { added: 30, deducted: 20 }, // closing 2025 = 12+30-20 = 22
            2026: { added: 30, deducted: 8 },  // closing 2026 = 22+30-8  = 44
            // Granted in full by add_year('2027') the moment that year was
            // opened — the stored row the ledger now reads verbatim.
            2027: { added: 30, deducted: 0 },
        },
    };
    const overAgeEmployee = {
        ...employee, id: 2, over_45: true,
        years_data: { ...employee.years_data, 2027: { added: 45, deducted: 0 } },
    };
    const years = ['2025', '2026', '2027'];

    // -------------------------------------------------------------
    // Rule 2: Jan 15, 2027 — the whole year is already granted.
    // -------------------------------------------------------------
    console.log('-- Rule 2: 2027-01-15 --');
    const jan15 = libyaInstant(2027, 1, 15);

    // January sits in the FIRST installment, so the header names the end
    // of that installment (30/06) — not the year end. Claiming 31/12 in
    // January would tell the employee they hold days that the 1 July
    // release has not handed out yet.
    assert(
        getAccrualLabel(jan15) === 'مضاف حتى 30/06/2027',
        `header reads "مضاف حتى 30/06/2027" (got "${getAccrualLabel(jan15)}")`
    );
    assert(getYearEndDateStr(jan15) === '31/12/2027', 'year-end string flipped to 31/12/2027 on Jan 15');

    const ledgerJan15 = computeYearlyLedger(employee, years, 2027, jan15);
    const row2027Jan15 = ledgerJan15.find((r) => r.year === '2027');
    assert(row2027Jan15.added === 30, 'ledger: the full 30 days show on Jan 15, not a monthly fraction');
    assert(row2027Jan15.opening === 44, '2027 opening (44) === 2026 closing, carried forward unchanged');

    // -------------------------------------------------------------
    // Rule 3: Feb 1, 2027 — a month has closed and NOTHING moves.
    // This is the core manual-allocation invariant: no monthly drip.
    // -------------------------------------------------------------
    console.log('\n-- Rule 3: 2027-02-01 --');
    const feb1 = libyaInstant(2027, 2, 1);

    assert(
        getAccrualLabel(feb1) === 'مضاف حتى 30/06/2027',
        `header still reads "مضاف حتى 30/06/2027" after a month closes (got "${getAccrualLabel(feb1)}")`
    );

    const ledgerFeb1 = computeYearlyLedger(employee, years, 2027, feb1);
    const row2027Feb1 = ledgerFeb1.find((r) => r.year === '2027');
    assert(row2027Feb1.added === 30, 'ledger: 2027 "added" is still 30 on Feb 1 — no monthly accrual');
    assert(row2027Feb1.added === row2027Jan15.added, 'the grant is identical on Jan 15 and on Feb 1');

    const ledgerFeb1Over45 = computeYearlyLedger(overAgeEmployee, years, 2027, feb1);
    assert(ledgerFeb1Over45.find((r) => r.year === '2027').added === 45, '45-day track shows its full 45 days');

    // -------------------------------------------------------------
    // Rule 3b: the label follows the calendar year, and only the year.
    // -------------------------------------------------------------
    console.log('\n-- Rule 3b: the "مضاف حتى" label across the flip --');
    assert(
        getAccrualLabel(libyaInstant(2026, 12, 31)) === 'مضاف حتى 31/12/2026',
        'Dec 31, 2026 still reads "مضاف حتى 31/12/2026"'
    );
    assert(
        getAccrualLabel(libyaInstant(2027, 1, 1)) === 'مضاف حتى 30/06/2027',
        'Jan 1, 2027 rolls the label over to the new year\'s first installment on its own'
    );
    assert(
        getAccrualLabel(libyaInstant(2027, 7, 31)) === 'مضاف حتى 31/12/2027',
        'mid-year (Jul 31) the label does NOT drift back to the last closed month'
    );

    // The 1 July release, at the exact boundary: the label must flip on
    // the day the second installment lands and not one day early or late.
    assert(
        getAllocationPeriodEndStr(libyaInstant(2027, 6, 30)) === '30/06/2027',
        'Jun 30 is still inside the first installment'
    );
    assert(
        getAllocationPeriodEndStr(libyaInstant(2027, 7, 1)) === '31/12/2027',
        'Jul 1 releases the second installment and the label follows the same day'
    );

    // -------------------------------------------------------------
    // Rule 4: 2026 (and 2025) stay immutable once 2027 is active.
    // -------------------------------------------------------------
    console.log('\n-- Rule 4: historical years are locked --');
    for (const ledger of [ledgerJan15, ledgerFeb1]) {
        const row2025 = ledger.find((r) => r.year === '2025');
        const row2026 = ledger.find((r) => r.year === '2026');
        assert(row2025.added === 30 && row2025.deducted === 20, '2025 added/deducted read verbatim from storage');
        assert(row2025.closing === 22, '2025 closing = 22 (12 + 30 - 20), unaffected by the 2027 view');
        assert(row2026.added === 30 && row2026.deducted === 8, '2026 added/deducted read verbatim from storage');
        assert(row2026.closing === 44, '2026 closing = 44, unaffected by the 2027 view');
        assert(row2026.closing === ledger.find((r) => r.year === '2027').opening,
            "2026's closing feeds 2027's opening exactly (previous_cumulative_balance)");
    }

    // -------------------------------------------------------------
    // Boundary sanity: no negative balances, no exceptions, across
    // every day of the flip week.
    // -------------------------------------------------------------
    console.log('\n-- Boundary sweep: Dec 28, 2026 -> Feb 2, 2027 --');
    const sweepDays = [
        [2026, 12, 28], [2026, 12, 29], [2026, 12, 30], [2026, 12, 31],
        [2027, 1, 1], [2027, 1, 2], [2027, 1, 15], [2027, 1, 31],
        [2027, 2, 1], [2027, 2, 2],
    ];
    let sweepOk = true;
    for (const [y, m, d] of sweepDays) {
        try {
            const now = libyaInstant(y, m, d);
            const ledger = computeYearlyLedger(employee, years, 2027, now);
            const negative = ledger.some((r) => r.closing < 0 || r.opening < 0 || r.added < 0 || r.deducted < 0);
            if (negative) {
                sweepOk = false;
                console.error(`  ❌ negative value found on ${y}-${m}-${d}:`, ledger);
            }
        } catch (err) {
            sweepOk = false;
            console.error(`  ❌ exception thrown on ${y}-${m}-${d}:`, err);
        }
    }
    assert(sweepOk, `no errors and no negative values across ${sweepDays.length} simulated days`);

    // -------------------------------------------------------------
    console.log('\n══════════════════════════════════════════');
    console.log(`  RESULT: ${pass} passed, ${fail} failed`);
    console.log('══════════════════════════════════════════');
    return { pass, fail };
}

// Allow `node src/tests/yearFlipSimulation.js` to run it directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { fail: failCount } = runYearFlipSimulation();
    if (failCount > 0) process.exit(1);
}
