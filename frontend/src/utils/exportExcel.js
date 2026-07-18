import * as XLSX from 'xlsx';
import { getLibyaDateStr, getLibyaYear } from './libyaTime.js';
import { computeYearlyLedger } from './leaveCalc.js';

export function exportEmployeesToExcel(employees, years) {
    const realLibyaYear = Number(getLibyaYear());
    const rows = employees.map((emp, index) => {
        const monthlyRate = emp.over_45 ? 3.75 : 2.5;
        const ledger = computeYearlyLedger(emp, years, realLibyaYear, monthlyRate);
        const row = {
            '#': index + 1,
            'الاسم': emp.name,
            'الرقم الوظيفي': emp.job_number || '-',
            'الوطني': emp.national_id || '-',
            'الصفة': emp.job_title || '-',
        };
        for (const entry of ledger) {
            row[`${entry.year} - الصافي التراكمي للسنوات السابقة`] = entry.opening;
            row[`${entry.year} - مضاف`] = entry.added;
            row[`${entry.year} - مخصوم`] = entry.deducted;
            row[`${entry.year} - الصافي التراكمي`] = entry.closing;
        }
        return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'أرصدة الإجازات');
    ws['!rtl'] = true;
    const cols = Object.keys(rows[0] || {}).map((k) => ({ wch: k.length > 10 ? 22 : 14 }));
    ws['!cols'] = cols;
    XLSX.writeFile(wb, `أرصدة_الإجازات_${getLibyaDateStr()}.xlsx`);
}
