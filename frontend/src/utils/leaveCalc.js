import { getLibyaYear } from './libyaTime.js';

// The employee's entitlement for a single year, as GRANTED — never as
// accrued. Since the move to manual allocation, `years_data[year].added`
// is the authoritative figure for every year including the current one:
// the database writes it once, in full, when the year is opened
// (add_year) or when the employee is created (create_employee, which
// prorates only the employee's own hire year). The front-end therefore
// reads it verbatim and never recomputes it from the clock — that is the
// whole point of "manual": what the admin sees is the stored number.
//
// The single exception is unpaid leave, which freezes the CURRENT year's
// grant at 0 while leaving every stored historical figure untouched.
export function getYearAdded(employee, year, currentYear) {
    const yd = employee.years_data?.[String(year)];
    if (employee.is_unpaid_leave && Number(year) === Number(currentYear)) return 0;
    return parseFloat(yd?.added) || 0;
}

export function computeYearlyLedger(employee, years, realLibyaYear) {
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
        // Every year — closed or active — reads its added/deducted verbatim
        // from stored years_data. Nothing here ever rewrites a year's
        // numbers, it only carries the resulting `opening` forward, which
        // is what keeps each year's net balance immutable once the next
        // financial year begins.
        const yd = employee.years_data?.[yearStr] || { added: 0, deducted: 0 };
        const added = getYearAdded(employee, yearStr, realLibyaYear);
        const deducted = parseFloat(yd.deducted) || 0;
        // toFixed(2): a prorated hire-year grant lands on quarter days
        // (3.75, 11.25, ...) on the 45-day track — toFixed(1) would round
        // 3.75 to 3.8 and silently corrupt that employee's running balance.
        const closing = +(opening + added - deducted).toFixed(2);
        const row = { year, opening, added, deducted, closing };
        opening = closing;
        return row;
    });
}

// The employee's available balance: carried-forward + every year's granted
// days - every year's deductions. This is the single implementation the
// deduction guard, the printed statement and the leave-request form all
// share, and it is a deliberate mirror of the database's
// employee_net_balance() so the UI can never promise days the server-side
// guard would reject.
export function computeNetBalance(employee, now = new Date()) {
    const currentYear = getLibyaYear(now);
    const yearsData = employee.years_data || {};
    let balance = parseFloat(employee.initial_carried_forward) || 0;
    for (const [year, yd] of Object.entries(yearsData)) {
        balance += getYearAdded(employee, year, currentYear) - (parseFloat(yd?.deducted) || 0);
    }
    return +balance.toFixed(2);
}

// FIFO audit: deduct from previous years' carry-over BEFORE current year.
// For unpaid leave, only the current year's grant is 0 — historical
// carry-over and past years' balances are still visible.
export function computeFifoAudit(employee, years, now = new Date()) {
    const currentYear = Number(getLibyaYear(now));
    let previousCarryOver = parseFloat(employee.initial_carried_forward) || 0;

    for (const yr of years) {
        if (Number(yr) >= currentYear) break;
        const yd = employee.years_data?.[yr] || { added: 0, deducted: 0 };
        previousCarryOver += (parseFloat(yd.added) || 0) - (parseFloat(yd.deducted) || 0);
    }
    previousCarryOver = Math.max(0, previousCarryOver);

    // Unpaid leave: the employee's historical carry-over is preserved for
    // the FIFO audit, but the current year's grant is frozen at 0.
    const currentYearAdded = getYearAdded(employee, currentYear, currentYear);
    const totalDeducted = parseFloat(employee.years_data?.[currentYear]?.deducted) || 0;

    // FIFO: consume previous carry-over first, then the current year's grant
    const consumedFromPrev = Math.min(previousCarryOver, totalDeducted);
    const consumedFromCurrent = Math.max(0, totalDeducted - consumedFromPrev);
    const legalNet = +(currentYearAdded - consumedFromCurrent).toFixed(2);

    return { previousCarryOver, currentYearAdded, totalDeducted, consumedFromPrev, consumedFromCurrent, legalNet };
}
