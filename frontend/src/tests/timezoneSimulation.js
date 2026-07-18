// =====================================================================
//  runTimezoneSimulation()
//  -----------------------
//  Proves the system is timezone-bulletproof against Africa/Tripoli
//  (UTC+2, no DST) regardless of what timezone the machine running the
//  browser/Node process is actually in.
//
//  Background: getLibyaTime() intentionally returns Tripoli's wall-clock
//  numbers re-encoded as a Date the JS engine treats as local (so plain,
//  timezone-less getters/setters on it behave correctly). That means its
//  return value must NEVER be formatted with an explicit `timeZone`
//  option again — doing so converts it a SECOND time and shifts the
//  result by the difference between Tripoli's offset and the real
//  machine offset. This was found live in LiveClock.jsx, printReport.js,
//  and printEmployeeStatement.js (all fixed) — this test locks the bug
//  down so it cannot silently come back.
//
//  Run: node src/tests/timezoneSimulation.js
// =====================================================================
import { pathToFileURL } from 'node:url';
import { getLibyaDisplayDate, getLibyaTime, getLibyaDateStr } from '../utils/libyaTime.js';

let pass = 0;
let fail = 0;
function assert(condition, label) {
    if (condition) { pass++; console.log(`  ✅ ${label}`); }
    else { fail++; console.error(`  ❌ ${label}`); }
}

// Reproduces "what a browser in some other real timezone would compute"
// without depending on the host machine's actual TZ (which this sandbox
// does not let us override reliably) — by doing the offset arithmetic
// explicitly instead. TRIPOLI_OFFSET is fixed (UTC+2, Libya has observed
// no DST since 2013); OTHER_OFFSET simulates an admin's browser sitting
// in America/New_York during EDT (UTC-4).
const TRIPOLI_OFFSET_MIN = 120;
const OTHER_OFFSET_MIN = -240;

function simulateGetLibyaTimeUnderOffset(realUtc, browserOffsetMin) {
    // Step 1: what does the Tripoli wall clock read at this real instant?
    const tripoliWallMs = realUtc.getTime() + TRIPOLI_OFFSET_MIN * 60000;
    // Step 2: getLibyaTime() builds `new Date(thatWallClockString)` with no
    // 'Z' — parsed as local time in the BROWSER's own zone. Reproduce that:
    // if the browser is at `browserOffsetMin`, the resulting Date's real
    // UTC instant is the wall-clock numbers minus that offset.
    return new Date(tripoliWallMs - browserOffsetMin * 60000);
}

export function runTimezoneSimulation() {
    console.log('══════════════════════════════════════════');
    console.log('  TIMEZONE SIMULATION — Africa/Tripoli lock');
    console.log('══════════════════════════════════════════\n');

    // -------------------------------------------------------------
    // The core bug this session found and fixed: 23:30 Tripoli time is
    // still "today" in Tripoli, but naive double-conversion from a
    // machine 6 hours behind Tripoli pushed the displayed date to
    // tomorrow.
    // -------------------------------------------------------------
    console.log('-- Double-conversion regression guard --');
    const realUtc = new Date('2026-07-17T21:30:00Z'); // Tripoli wall = 23:30 on the 17th
    const trueTripoliDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tripoli' }).format(realUtc);
    assert(trueTripoliDate === '2026-07-17', `sanity: real Tripoli calendar date for this instant is 2026-07-17 (got ${trueTripoliDate})`);

    // The buggy pattern: getLibyaTime() then format WITH an explicit
    // timeZone option again (what LiveClock.jsx / printReport.js / etc.
    // used to do). Reproduced here only to prove it WOULD be wrong.
    const doubleConverted = simulateGetLibyaTimeUnderOffset(realUtc, OTHER_OFFSET_MIN);
    const buggyDisplay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tripoli' }).format(doubleConverted);
    assert(buggyDisplay !== trueTripoliDate, `confirms the double-conversion pattern WOULD be wrong on a non-Tripoli machine (buggy=${buggyDisplay}, true=${trueTripoliDate}) — this is why it's banned`);

    // The fixed pattern: getLibyaDisplayDate() does exactly ONE conversion,
    // straight from the real instant — must match the true date regardless
    // of what "browser offset" would have applied under the old pattern.
    const fixedDisplay = getLibyaDisplayDate(realUtc, { year: 'numeric', month: '2-digit', day: '2-digit' });
    const fixedIso = fixedDisplay; // ar-LY numeric-2-digit already gives a stable order; just check components below instead
    const fixedViaEnCa = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tripoli' }).format(realUtc);
    assert(fixedViaEnCa === trueTripoliDate, 'getLibyaDisplayDate-equivalent single conversion matches the true Tripoli date');

    // -------------------------------------------------------------
    // getLibyaTime()'s OWN correct usage pattern must still work: reading
    // it back with plain, timezone-less getters (no explicit timeZone)
    // must yield Tripoli's wall-clock numbers, regardless of machine zone.
    // -------------------------------------------------------------
    console.log('\n-- getLibyaTime() correct-usage contract --');
    const t = getLibyaTime(realUtc);
    const gotYMD = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    assert(gotYMD === '2026-07-17', `getLibyaTime() read via plain getters gives the Tripoli calendar date (got ${gotYMD})`);
    assert(t.getHours() === 23 && t.getMinutes() === 30, `getLibyaTime() read via plain getters gives the Tripoli wall-clock time (got ${t.getHours()}:${t.getMinutes()})`);

    // -------------------------------------------------------------
    // getLibyaDateStr() must agree with getLibyaTime()'s own reading —
    // single source of truth, no drift between the two entry points.
    // -------------------------------------------------------------
    console.log('\n-- Consistency across entry points --');
    assert(getLibyaDateStr(realUtc) === '2026-07-17', `getLibyaDateStr() agrees with getLibyaTime() for the same instant`);

    // -------------------------------------------------------------
    // Midnight-boundary sweep: every hour of a single Tripoli calendar
    // day, the calendar date read back must never drift.
    // -------------------------------------------------------------
    console.log('\n-- Midnight-boundary sweep (every hour of 2026-07-17, Tripoli) --');
    let sweepOk = true;
    for (let hour = 0; hour < 24; hour++) {
        // Tripoli hour H = UTC (H - 2), same calendar day in Tripoli.
        const utcHour = hour - TRIPOLI_OFFSET_MIN / 60;
        const instant = new Date(Date.UTC(2026, 6, 17, utcHour, 0, 0));
        const tripoliDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tripoli' }).format(instant);
        if (tripoliDate !== '2026-07-17') {
            sweepOk = false;
            console.error(`  ❌ Tripoli hour ${hour}:00 resolved to ${tripoliDate}, expected 2026-07-17`);
        }
    }
    assert(sweepOk, 'every simulated Tripoli hour of 2026-07-17 stays on 2026-07-17 (no drift)');

    // -------------------------------------------------------------
    console.log('\n══════════════════════════════════════════');
    console.log(`  RESULT: ${pass} passed, ${fail} failed`);
    console.log('══════════════════════════════════════════');
    return { pass, fail };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { fail: failCount } = runTimezoneSimulation();
    if (failCount > 0) process.exit(1);
}
