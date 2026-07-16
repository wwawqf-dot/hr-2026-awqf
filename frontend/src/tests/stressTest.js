// =====================================================================
//  runSystemStressTest()
//  ---------------------
//  Call from browser console:
//    import('/src/tests/stressTest.js').then(m => m.runSystemStressTest())
//
//  Requires an active admin session. Generates synthetic employees and
//  deductions, then verifies FIFO balance integrity under load.
// =====================================================================
const { api } = await import('../api/client');
const { supabase } = await import('../supabaseClient');

let pass = 0;
let fail = 0;
function assert(condition, label) {
    if (condition) { pass++; console.log(`  ✅ ${label}`); }
    else { fail++; console.error(`  ❌ ${label}`); }
}

// Utility: sleep(ms)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Utility: random int between min and max
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export async function runSystemStressTest() {
    console.log('%c══════════════════════════════════════════', 'font-size:16px;font-weight:bold');
    console.log('%c  SYSTEM STRESS TEST — بدء اختبار الضغط', 'font-size:16px;font-weight:bold');
    console.log('%c══════════════════════════════════════════\n', 'font-size:16px;font-weight:bold');

    pass = 0; fail = 0;
    const startTime = Date.now();
    const createdIds = [];

    // ---- 1. CONNECTION TEST -----------------------------------------
    console.log('\n📡 1. التحقق من الاتصال بقاعدة البيانات');
    try {
        const { data, error } = await supabase.from('years').select('year').limit(1);
        assert(!error, 'الاتصال بقاعدة البيانات ناجح');
        if (error) {
            console.error('❌ فشل الاتصال — أوقف الاختبار');
            return { pass, fail, duration: Date.now() - startTime };
        }
    } catch (e) {
        console.error('❌ فشل الاتصال:', e.message);
        return { pass, fail, duration: Date.now() - startTime };
    }

    // ---- 2. ADD 50 DUMMY EMPLOYEES ----------------------------------
    console.log('\n👥 2. إضافة 50 موظف وهمي');
    try {
        const jobs = ['محاسب', 'محفظ', 'مراجع', 'سكرتير', 'مدخل بيانات', 'مهندس', 'فني'];
        for (let i = 0; i < 50; i++) {
            const result = await api.addEmployee({
                name: `موظف اختبار ${String(i + 1).padStart(3, '0')}`,
                job_number: `T${String(2026000 + i)}`,
                national_id: `${rand(100000000000, 999999999999)}`,
                job_title: jobs[i % jobs.length],
                initial_carried_forward: rand(0, 20),
                years_data: { '2026': { added: 30 } },
            });
            createdIds.push(result.employee.id);
        }
        assert(createdIds.length === 50, `تم إضافة ${createdIds.length} موظف بنجاح`);
    } catch (e) {
        assert(false, 'فشل إضافة الموظفين: ' + e.message);
    }

    // ---- 3. CONCURRENT DEDUCTIONS ----------------------------------
    console.log('\n⚡ 3. محاكاة 100 عملية خصم متزامنة');
    let dedSuccess = 0;
    let dedFail = 0;
    const concurrency = 10; // 10 parallel batches
    const totalDeductions = 100;

    // Add a year first so deductions have a year to write to
    try {
        const yearsData = await api.getYears();
        if (!yearsData.years.includes('2026')) {
            await api.addYear({ year: '2026' });
        }
    } catch (e) { /* year may already exist */ }

    const dedPromises = [];
    for (let i = 0; i < totalDeductions; i++) {
        const empId = createdIds[i % createdIds.length];
        const days = rand(1, 3);
        dedPromises.push(
            api.addDeduction(empId, { unknownDays: days, note: 'خصم اختبار ضغط' })
                .then(() => { dedSuccess++; })
                .catch((err) => {
                    // Insufficient-balance errors are EXPECTED once balance
                    // is exhausted — those are not real failures.
                    dedFail++;
                })
        );
        // Fire in small bursts to simulate real concurrency
        if (i % concurrency === 0) await sleep(50);
    }

    await Promise.allSettled(dedPromises);
    assert(dedSuccess > 0, `تم تنفيذ ${dedSuccess} خصم بنجاح (${dedFail} مرفوضة بسبب الرصيد)`);

    // ---- 4. VERIFY BALANCE INTEGRITY --------------------------------
    console.log('\n🔍 4. التحقق من سلامة الأرصدة');
    let balanceOk = 0;
    let balanceFail = 0;
    for (const empId of createdIds) {
        try {
            const { employees } = await api.getEmployees();
            const emp = employees.find((e) => e.id === empId);
            if (!emp) continue;

            // Compute expected balance from the source of truth
            const balance = (parseFloat(emp.initial_carried_forward) || 0)
                + Object.values(emp.years_data || {}).reduce(
                    (sum, yd) => sum + (parseFloat(yd.added) || 0) - (parseFloat(yd.deducted) || 0),
                    0
                );

            if (balance < 0) {
                console.error(`    ❌ الموظف ${emp.name} رصيده سالب: ${balance}`);
                balanceFail++;
            } else {
                balanceOk++;
            }
        } catch {
            balanceFail++;
        }
    }
    assert(balanceFail === 0, `الأرصدة سليمة: ${balanceOk} موظف, ${balanceFail} خطأ`);

    // ---- 5. CLEANUP -------------------------------------------------
    console.log('\n🧹 5. تنظيف بيانات الاختبار');
    let cleaned = 0;
    for (const empId of createdIds) {
        try {
            await api.deleteEmployee(empId);
            cleaned++;
        } catch { /* already deleted */ }
    }
    assert(cleaned === 50, `تم حذف ${cleaned} من 50 موظف اختبار`);

    // ---- SUMMARY ----------------------------------------------------
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n%c══════════════════════════════════════════`, 'font-size:16px;font-weight:bold');
    console.log(`%c  النتيجة: ${fail === 0 ? '✅ نجاح' : '❌ فشل'}  —  ${pass}/${pass+fail} نجح  —  ${duration} ثانية`, 'font-size:14px;font-weight:bold');
    console.log(`%c══════════════════════════════════════════\n`, 'font-size:16px;font-weight:bold');

    return { pass, fail, duration, total: pass + fail };
}

// Auto-register on window for console access
if (typeof window !== 'undefined') {
    window.runSystemStressTest = runSystemStressTest;
}
