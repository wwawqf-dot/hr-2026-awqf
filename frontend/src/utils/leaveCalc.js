import { getAccruedDays, getLibyaYear } from './libyaTime.js';

// `now` is an optional injectable Date (defaults to the real clock) so a
// simulation can verify exactly what the live system would render on a
// given future date — see tests/yearFlipSimulation.js.
export function computeYearlyLedger(employee, years, realLibyaYear, monthlyRate, now = new Date()) {
    const ceiledAtYear = employee.carryover_ceiled_at_year;
    const ceiledBalance = parseFloat(employee.ceiled_cumulative_balance) || null;
    let opening = parseFloat(employee.initial_carried_forward) || 0;
    let switchedToCeiled = false;
    return years.map((year) => {
        const yearStr = String(year);
        if (ceiledAtYear && ceiledBalance !== null && yearStr >= ceiledAtYear && !switchedToCeiled) {
            opening = ceiledBalance;
            switchedToCeiled = true;
        }
        // Past (closed) years always read their added/deducted verbatim from
        // stored years_data — only the active year's `added` is ever
        // recomputed dynamically. This is what keeps every prior year's
        // net balance immutable once a new financial year begins: nothing
        // here ever rewrites a past year's numbers, it only carries the
        // resulting `opening` forward.
        const yd = employee.years_data?.[yearStr] || { added: 0, deducted: 0 };
        let added = parseFloat(yd.added) || 0;
        if (Number(yearStr) === Number(realLibyaYear)) {
            // For unpaid leave the current year's accrual is frozen, but
            // the historical `initial_carried_forward` and past years'
            // added/deducted remain intact so the ledger is accurate.
            added = employee.is_unpaid_leave
                ? 0
                : getAccruedDays(Number(realLibyaYear), monthlyRate, employee.hire_date_current_year, now);
        }
        const deducted = parseFloat(yd.deducted) || 0;
        // toFixed(2): the 45-day track's 3.75/month rate needs two decimal
        // places — toFixed(1) would round 3.75 to 3.8 and silently corrupt
        // every over-45 employee's running balance.
        const closing = +(opening + added - deducted).toFixed(2);
        const row = { year, opening, added, deducted, closing };
        opening = closing;
        return row;
    });
}

// FIFO audit: deduct from previous years' carry-over BEFORE current year.
// For unpaid leave, only the current year's accrual is 0 — historical
// carry-over and past years' balances are still visible.
export function computeFifoAudit(employee, years, monthlyRate = 2.5, now = new Date()) {
    const currentYear = Number(getLibyaYear(now));
    let previousCarryOver = parseFloat(employee.initial_carried_forward) || 0;

    for (const yr of years) {
        if (Number(yr) >= currentYear) break;
        const yd = employee.years_data?.[yr] || { added: 0, deducted: 0 };
        previousCarryOver += (parseFloat(yd.added) || 0) - (parseFloat(yd.deducted) || 0);
    }
    previousCarryOver = Math.max(0, previousCarryOver);

    // Unpaid leave: the employee's historical carry-over is preserved for
    // the FIFO audit, but the current year accrual is frozen at 0.
    const accruedDays = employee.is_unpaid_leave
        ? 0
        : getAccruedDays(currentYear, monthlyRate, employee.hire_date_current_year, now);
    const totalDeducted = parseFloat(employee.years_data?.[currentYear]?.deducted) || 0;

    // FIFO: consume previous carry-over first, then current year accrual
    const consumedFromPrev = Math.min(previousCarryOver, totalDeducted);
    const consumedFromCurrent = Math.max(0, totalDeducted - consumedFromPrev);
    const legalNet = +(accruedDays - consumedFromCurrent).toFixed(2);

    return { previousCarryOver, accruedDays, totalDeducted, consumedFromPrev, consumedFromCurrent, legalNet };
}
