import * as XLSX from 'xlsx';

const REMAINING_BALANCE_HEADER = 'الرصيد المتبقي';
const JOB_NUMBER_HEADER = 'الرقم الوظيفي';

// Reads an uploaded .xlsx/.xls/.csv file and extracts rows using the exact
// column headers name / national_id / job_title (matched case-insensitively
// so "Name", "NAME", "name" are all accepted), plus an optional 4th column
// "الرصيد المتبقي" used to trigger automatic paper-reconciliation deductions.
export async function parseEmployeesExcel(file) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
        throw new Error('الملف لا يحتوي على أي ورقة بيانات');
    }
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) {
        throw new Error('الملف فارغ أو لا يحتوي على بيانات');
    }

    function getField(row, key) {
        const foundKey = Object.keys(row).find((k) => k.trim().toLowerCase() === key);
        return foundKey ? String(row[foundKey]).trim() : '';
    }

    function getArabicField(row, header) {
        const foundKey = Object.keys(row).find((k) => k.trim() === header);
        return foundKey ? String(row[foundKey]).trim() : '';
    }

    const parsed = rows.map((row) => {
        const remainingBalanceRaw = getArabicField(row, REMAINING_BALANCE_HEADER);
        return {
            name: getField(row, 'name'),
            job_number: getArabicField(row, JOB_NUMBER_HEADER),
            national_id: getField(row, 'national_id'),
            job_title: getField(row, 'job_title'),
            remainingBalance: remainingBalanceRaw !== '' ? remainingBalanceRaw : undefined,
        };
    });

    const hasAnyName = parsed.some((r) => r.name);
    if (!hasAnyName) {
        throw new Error(
            'لم يتم العثور على عمود "name" يحتوي على بيانات. تأكد من أن رأس العمود الأول هو name بالضبط.'
        );
    }

    return parsed;
}
