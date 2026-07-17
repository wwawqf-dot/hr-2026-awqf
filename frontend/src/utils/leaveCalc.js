import { getAccruedDays, getAccruedMonths, getLibyaYear } from './libyaTime';

export function computeYearlyLedger(employee, years, realLibyaYear, monthlyRate) {
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
        const yd = employee.years_data?.[yearStr] || { added: 0, deducted: 0 };
        let added = parseFloat(yd.added) || 0;
        if (Number(yearStr) === Number(realLibyaYear)) {
            added = getAccruedDays(Number(realLibyaYear), monthlyRate, employee.hire_date_current_year);
        }
        const deducted = parseFloat(yd.deducted) || 0;
        const closing = +(opening + added - deducted).toFixed(1);
        const row = { year, opening, added, deducted, closing };
        opening = closing;
        return row;
    });
}

// FIFO audit: deduct from previous years' carry-over BEFORE current year.
export function computeFifoAudit(employee, years, monthlyRate = 2.5) {
    const currentYear = Number(getLibyaYear());
    let previousCarryOver = parseFloat(employee.initial_carried_forward) || 0;

    for (const yr of years) {
        if (Number(yr) >= currentYear) break;
        const yd = employee.years_data?.[yr] || { added: 0, deducted: 0 };
        previousCarryOver += (parseFloat(yd.added) || 0) - (parseFloat(yd.deducted) || 0);
    }
    previousCarryOver = Math.max(0, previousCarryOver);

    const accruedDays = getAccruedDays(currentYear, monthlyRate, employee.hire_date_current_year);
    const totalDeducted = parseFloat(employee.years_data?.[currentYear]?.deducted) || 0;

    // FIFO: consume previous carry-over first, then current year accrual
    const consumedFromPrev = Math.min(previousCarryOver, totalDeducted);
    const consumedFromCurrent = Math.max(0, totalDeducted - consumedFromPrev);
    const legalNet = +(accruedDays - consumedFromCurrent).toFixed(1);

    return { previousCarryOver, accruedDays, totalDeducted, consumedFromPrev, consumedFromCurrent, legalNet };
}
