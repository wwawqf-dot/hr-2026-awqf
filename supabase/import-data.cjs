// استيراد بيانات الموظفين إلى Supabase
// يشغّل: node supabase/import-data.cjs <ملف-الجسون>
// الملف يجب أن يكون بصيغة تصدير JSON للنظام

const { createClient } = require('@supabase/supabase-js');
const { readFileSync, existsSync } = require('fs');

const url = process.env.VITE_SUPABASE_URL || 'https://uzmhsesmszngkanjsjgy.supabase.co';
const key = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6bWhzZXNtc3puZ2thbmpzamd5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzcwMjE0NywiZXhwIjoyMDk5Mjc4MTQ3fQ.6hD4DoCTZmhXPGn56lJmlOX2n_Yx0RozbQpaqwZWtyU';

const supabase = createClient(url, key);

async function main() {
    const filePath = process.argv[2];
    if (!filePath || !existsSync(filePath)) {
        console.error('الاستخدام: node supabase/import-data.cjs <ملف-الجسون>');
        console.error('مثال: node supabase/import-data.cjs مسار/الملف.json');
        process.exit(1);
    }

    const raw = JSON.parse(readFileSync(filePath, 'utf8'));

    let payload;
    if (raw.tables) {
        // تحويل من صيغة التصدير القديمة (من النسخة الاحتياطية SQLite -> Express)
        const backup = raw.tables;
        const employees = backup.employees.map(emp => {
            const yearsData = {};
            (backup.employee_years || [])
                .filter(ey => ey.employee_id === emp.id)
                .forEach(ey => { yearsData[String(ey.year)] = { added: Number(ey.added) || 0, deducted: Number(ey.deducted) || 0 }; });

            const deductionsHistory = (backup.deductions || [])
                .filter(d => d.employee_id === emp.id)
                .map(d => ({
                    id: d.id,
                    year: String(d.year),
                    start: d.start_date || '',
                    end: d.end_date || '',
                    days: Number(d.days) || 0,
                    note: d.note || '',
                    createdBy: d.created_by || '',
                    createdAt: d.created_at || new Date().toISOString()
                }));

            return {
                id: emp.id,
                name: emp.name,
                job_number: String(emp.job_number || ''),
                national_id: String(emp.national_id || ''),
                job_title: String(emp.job_title || ''),
                initial_carried_forward: Number(emp.initial_carried_forward) || 0,
                over_45: emp.over_45 === 1 || emp.over_45 === true,
                is_frozen: emp.is_frozen === 1 || emp.is_frozen === true,
                hire_date: emp.hire_date || '',
                createdAt: emp.created_at || new Date().toISOString(),
                years_data: yearsData,
                deductions_history: deductionsHistory
            };
        });

        const settings = {};
        (backup.settings || []).forEach(s => { settings[s.key] = s.value; });

        payload = {
            years: (backup.years || []).map(y => String(y.year)),
            employees,
            settings
        };
    } else if (raw.employees && raw.years) {
        // صيغة sync_employees مباشرة (من تصدير JSON في النظام الجديد)
        payload = raw;
    } else {
        console.error('صيغة الملف غير معروفة. يجب أن يكون ملف تصدير JSON صادراً من النظام.');
        process.exit(1);
    }

    console.log('البيانات المراد استيرادها:');
    console.log('  - السنوات: ' + payload.years.join(', '));
    console.log('  - الموظفون: ' + payload.employees.length);
    console.log('جاري رفع البيانات إلى Supabase...');

    const { data, error } = await supabase.rpc('sync_employees', { p_payload: payload });

    if (error) {
        console.error('فشل الاستيراد: ' + error.message);
        process.exit(1);
    }

    console.log('\nتم الاستيراد بنجاح:');
    console.log('  - موظفون جدد: ' + data.created);
    console.log('  - تحديثات: ' + data.updated);
    console.log('  - خصومات: ' + data.deductions);
}

main();
