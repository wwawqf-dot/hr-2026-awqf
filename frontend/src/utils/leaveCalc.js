// Chronological multi-year carry-over ledger for one employee.
//
// Core rule: OpeningBalance(Y) = ClosingBalance(Y - 1). The first active
// year seeds its opening balance from the employee's historical
// `initial_carried_forward` (the pre-digital paper balance, "past
// cumulative balance"); every year after that inherits the previous
// year's closing balance automatically as it walks forward through
// `years` in order — so opening balances never need to be re-entered or
// overwritten when a new financial year is added.
export function computeYearlyLedger(employee, years) {
    let opening = parseFloat(employee.initial_carried_forward) || 0;
    return years.map((year) => {
        const yd = employee.years_data?.[year] || { added: 0, deducted: 0 };
        const added = parseFloat(yd.added) || 0;
        const deducted = parseFloat(yd.deducted) || 0;
        const closing = opening + added - deducted;
        const row = { year, opening, added, deducted, closing };
        opening = closing;
        return row;
    });
}
