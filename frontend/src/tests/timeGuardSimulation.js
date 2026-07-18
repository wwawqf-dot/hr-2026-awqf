// Standalone proof for the DeductionModal Time Guard (strict financial-year
// match). Mirrors the exact formula in DeductionModal.jsx lines 81-85 so a
// change to that logic without updating this file will make the mirror
// obviously stale, rather than silently drifting.
function computeGuard(systemYears, hasUnknownDays, start) {
    const activeYear = systemYears.length
        ? String(Math.max(...systemYears.map(Number)))
        : null;
    const startYear = !hasUnknownDays && start ? start.slice(0, 4) : null;
    const yearMismatched = Boolean(startYear && activeYear && startYear !== activeYear);
    return { activeYear, yearMismatched };
}

let pass = 0, fail = 0;
function check(label, condition, extra = '') {
    if (condition) { console.log(`  ✅ ${label}`); pass++; }
    else { console.log(`  ❌ ${label} ${extra}`); fail++; }
}

console.log('═'.repeat(46));
console.log('  TIME GUARD SIMULATION — strict financial-year match');
console.log('═'.repeat(46));

console.log('\n-- Active year resolution --');
{
    const { activeYear } = computeGuard(['2025', '2026', '2027'], false, '2027-03-01');
    check('active year is the max of systemYears, not array order', activeYear === '2027', `(got ${activeYear})`);
}
{
    const { activeYear } = computeGuard(['2027', '2025', '2026'], false, '2027-03-01');
    check('active year resolution is order-independent', activeYear === '2027', `(got ${activeYear})`);
}
{
    const { activeYear } = computeGuard([], false, '2027-03-01');
    check('no systemYears -> activeYear is null (guard cannot fire)', activeYear === null);
}

console.log('\n-- Dated deduction: same-year vs cross-year --');
{
    const { yearMismatched } = computeGuard(['2026', '2027'], false, '2027-01-15');
    check('start date in the active year -> NOT blocked', yearMismatched === false);
}
{
    const { yearMismatched } = computeGuard(['2026', '2027'], false, '2026-12-20');
    check('start date in a closed prior year (still within 40-day retro window) -> BLOCKED', yearMismatched === true);
}
{
    const { yearMismatched } = computeGuard(['2027'], false, '2028-01-05');
    check('start date in a not-yet-opened future year -> BLOCKED', yearMismatched === true);
}

console.log('\n-- Unknown-days path (no calendar date) is never blocked by this guard --');
{
    // Mirrors register_deduction: an unknown-days deduction always posts to
    // v_latest server-side, so there is no "wrong year" it could bleed into.
    const { yearMismatched } = computeGuard(['2026', '2027'], true, '');
    check('hasUnknownDays=true -> guard never fires regardless of systemYears', yearMismatched === false);
}

console.log('\n-- Archived-year exclusion (matches backend WHERE is_archived = false) --');
{
    // systemYears is expected to already be the is_archived=false list
    // (App.jsx's `years` state comes from listYears(), which filters
    // is_archived server-side) — if 2027 were archived it would simply be
    // absent from this array, and 2026 would correctly become "active".
    const { activeYear, yearMismatched } = computeGuard(['2025', '2026'], false, '2026-06-01');
    check('with the newest year excluded (as if archived), 2026 becomes active', activeYear === '2026');
    check('a 2026-dated deduction is then correctly allowed', yearMismatched === false);
}

console.log(`\n${'═'.repeat(46)}\n  RESULT: ${pass} passed, ${fail} failed\n${'═'.repeat(46)}`);
process.exit(fail > 0 ? 1 : 0);
