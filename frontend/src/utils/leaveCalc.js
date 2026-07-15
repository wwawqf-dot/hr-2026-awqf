export function computeBreakdown(employee, years) {
    let runningNet = parseFloat(employee.initial_carried_forward) || 0;
    return years.map((year) => {
        const yd = employee.years_data?.[year] || { added: 0, deducted: 0 };
        const added = parseFloat(yd.added) || 0;
        const deducted = parseFloat(yd.deducted) || 0;
        runningNet = runningNet + added - deducted;
        return { year, added, deducted, runningNet };
    });
}
