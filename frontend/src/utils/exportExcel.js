import ExcelJS from 'exceljs';
import { getLibyaDateStr, getLibyaYear } from './libyaTime.js';
import { computeYearlyLedger } from './leaveCalc.js';

export async function exportEmployeesToExcel(employees, years) {
    const realLibyaYear = Number(getLibyaYear());
    const isMultiYear = years.length > 1;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'نظام إدارة الإجازات';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('أرصدة الإجازات', {
        views: [{ rightToLeft: true, showGridLines: false }],
    });

    const fixedHeaders = ['#', 'الاسم', 'الرقم الوظيفي', 'الوطني', 'الصفة'];
    const colWidths = [5, 30, 14, 16, 14];

    if (isMultiYear) {
        years.forEach((year) => {
            const label = year === realLibyaYear ? 'المضافة حديثاً' : `مضاف ${year}`;
            fixedHeaders.push(
                `الصافي التراكمي للسنوات السابقة\n(حتى ${year})`,
                label,
                `مخصوم ${year}`,
                `الصافي التراكمي ${year}`,
            );
            for (let i = 0; i < 4; i++) colWidths.push(17);
        });
    } else {
        const year = years[0] || String(realLibyaYear);
        const label = year === String(realLibyaYear) ? 'المضافة حديثاً' : `مضاف ${year}`;
        fixedHeaders.push(
            'الصافي التراكمي للسنوات السابقة',
            label,
            `مخصوم ${year}`,
            'الصافي التراكمي',
        );
        for (let i = 0; i < 4; i++) colWidths.push(20);
    }

    colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    const totalCols = fixedHeaders.length;
    ws.pageSetup = {
        paperSize: 9,
        orientation: totalCols > 6 ? 'landscape' : 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { top: 0.5, right: 0.3, bottom: 0.8, left: 0.3, header: 0.2, footer: 0.5 },
    };

    const darkSlate = { argb: 'FF1E3A5F' };
    const thinBorder = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' },
    };

    const headerRow = ws.addRow(fixedHeaders);
    headerRow.height = 36;
    headerRow.eachCell((cell) => {
        cell.font = { name: 'Tajawal', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: darkSlate };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = thinBorder;
    });

    // Same frozen-last ordering as the on-screen table (EmployeesTable.jsx) —
    // without this the exported row order could disagree with what the
    // admin just saw on screen.
    const sortedEmployees = [...employees].sort((a, b) => (a.is_frozen ? 1 : 0) - (b.is_frozen ? 1 : 0));

    sortedEmployees.forEach((emp, idx) => {
        const monthlyRate = emp.over_45 ? 3.75 : 2.5;
        const ledger = computeYearlyLedger(emp, years, realLibyaYear, monthlyRate);
        const rowData = [idx + 1, emp.name, emp.job_number || '-', emp.national_id || '-', emp.job_title || '-'];

        if (isMultiYear) {
            ledger.forEach((entry) => rowData.push(entry.opening, entry.added, entry.deducted, entry.closing));
        } else {
            const entry = ledger[0];
            if (entry) rowData.push(entry.opening, entry.added, entry.deducted, entry.closing);
        }

        const row = ws.addRow(rowData);
        row.height = 22;
        row.eachCell((cell) => {
            cell.font = { name: 'Tajawal', size: 10 };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = thinBorder;
        });
        row.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
    });

    ws.headerFooter.oddFooter =
        '&"Tajawal,Bold"&10&Rمراجعة وحدة شؤون الموظفين &Cاعتماد رئيس قسم الشؤون الإدارية &Lاعتماد مدير مكتب أوقاف القره بوللي';

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `أرصدة_الإجازات_${getLibyaDateStr()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
