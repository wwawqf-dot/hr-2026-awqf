import { formatDateDisplay } from './formatDate.js';
import { getLibyaDisplayDate, getAccrualLabel, getLibyaYear } from './libyaTime.js';
import { computeYearlyLedger } from './leaveCalc.js';

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function printReport(selectedYear, years, employees, openingBalanceDate) {
    const isAllYears = selectedYear === 'all';
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('يرجى السماح للنوافذ المنبثقة لطباعة التقرير.');
        return;
    }

    // Single Tripoli conversion straight from the real instant — do NOT
    // route this through getLibyaTime().toLocaleDateString(timeZone:...),
    // which double-converts and can print the wrong calendar day (proven:
    // an admin whose machine isn't already in Africa/Tripoli would see the
    // issue date shifted, occasionally to the wrong day near midnight).
    const formattedDate = getLibyaDisplayDate(new Date());
    const carriedLabel = `المرحل حتى ${formatDateDisplay(openingBalanceDate)}`;
    const accrualLabel = getAccrualLabel();
    const realLibyaYear = getLibyaYear();

    const fixedColumnCount = 4;
    const yearColumnCount = isAllYears ? years.length * 4 : 4;
    const totalColumnCount = fixedColumnCount + yearColumnCount;

    let tableFontSize = 14;
    let cellPadding = '10px 5px';
    if (totalColumnCount > 16) { tableFontSize = 10; cellPadding = '6px 3px'; }
    else if (totalColumnCount > 12) { tableFontSize = 11; cellPadding = '7px 4px'; }
    else if (totalColumnCount > 9) { tableFontSize = 12; cellPadding = '8px 4px'; }

    let html = `
    <html dir="rtl" lang="ar">
    <head>
        <title>التقرير الإجمالي السنوي لأرصدة إجازات الموظفين</title>
        <link href="${window.location.origin}/fonts/tajawal/tajawal.css" rel="stylesheet">
        <style>
            body { font-family: 'Tajawal', sans-serif; padding: 30px; color: #000; background: #fff; }
            .report-header { text-align: center; margin-bottom: 15px; line-height: 1.8; }
            .report-header h3 { margin: 0; font-size: 20px; font-weight: 800; }
            .report-header h2 { margin: 15px 0 10px 0; font-size: 24px; font-weight: 800; }
            .report-header p { margin: 0; font-size: 15px; }
            table { width: 100%; table-layout: auto; border-collapse: collapse; margin-top: 10px; font-size: ${tableFontSize}px; text-align: center; }
            th, td { border: 2px solid #000; padding: ${cellPadding}; }
            th { font-weight: 800; background-color: #fff; }
            td.name-col { text-align: right; padding-right: 15px; font-weight: 700; }
            td { font-weight: 700; }
            .signatures { margin-top: 4rem; padding-top: 2rem; display: flex; justify-content: space-between; text-align: center; padding: 2rem 20px 0; }
            .sig-col { flex: 1; display: flex; flex-direction: column; align-items: center; }
            .sig-space { width: 70%; height: 70px; border-bottom: 1.5px solid #000; margin-bottom: 12px; }
            .sig-text { margin: 0; font-size: 14px; font-weight: 700; }
            .footer-note { margin-top: 50px; font-size: 12px; color: #333; text-align: right; font-weight: 500; }
            @media print {
                @page { size: A4 landscape; margin: 10mm; }
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; width: 100%; padding: 0; box-sizing: border-box !important; }
                .no-print { display: none; }
                table { box-sizing: border-box !important; border-collapse: collapse !important; width: 98% !important; margin: 0 auto !important; border: 2px solid #000 !important; }
                th, td { border: 1px solid #000 !important; padding: 8px !important; }
                tr { page-break-inside: avoid !important; }
                thead { display: table-header-group; }
                .signatures { page-break-inside: avoid !important; }
            }
        </style>
    </head>
    <body>
        <div class="no-print" style="margin-bottom: 20px; text-align: center;">
            <button onclick="window.print()" style="padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 5px; cursor: pointer; font-family: 'Tajawal'; font-size: 16px; font-weight: bold;">طباعة التقرير الآن</button>
        </div>

        <div class="report-header">
            <h3>الهيئة العامة للأوقاف والشؤون الإسلامية</h3>
            <h3>مكتب الأوقاف والشؤون الإسلامية القره بوللي</h3>
            <h2>التقرير الإجمالي السنوي لأرصدة إجازات الموظفين</h2>
            <p>تاريخ الإصدار: ${formattedDate}</p>
        </div>

        <hr style="border: 0; border-top: 3px solid #000; margin-bottom: 20px;">

        <table>
            <thead>
                <tr>
                    <th style="width: 40px;">#</th>
                    <th style="min-width: 150px;">اسم الموظف</th>
                    <th style="min-width: 80px;">الرقم الوظيفي</th>
                    <th>الوطني</th>
                    <th>الصفة</th>
    `;

    if (isAllYears) {
        years.forEach((year) => {
            const addedLabel = year === realLibyaYear ? accrualLabel : `مضاف ${year}`;
            html += `
                <th style="white-space: nowrap; line-height: 1.3; padding: 8px 7px;">
                    (الصافي التراكمي للسنوات السابقة)<br>
                    <span style="font-size: 0.75em; font-weight: 600;">حتى تاريخ 31/12/${year - 1}</span>
                </th>
                <th>${addedLabel}</th>
                <th>مخصوم ${year}</th>
                <th>الصافي التراكمي ${year}</th>
            `;
        });
    } else {
        const addedLabel = selectedYear === realLibyaYear ? accrualLabel : `مضاف ${selectedYear}`;
        html += `
            <th>${carriedLabel}</th>
            <th>${addedLabel}</th>
            <th>مخصوم ${selectedYear}</th>
            <th>الصافي التراكمي ${selectedYear}</th>
        `;
    }

    html += `</tr></thead><tbody>`;

    // Print visibility depends ONLY on is_frozen + include_in_print — never
    // on is_unpaid_leave (a previous `e.is_unpaid_leave ||` short-circuit
    // here forced a frozen employee with include_in_print=false back into
    // the printout whenever they were also on unpaid leave; that flag is an
    // unrelated balance-calculation concern and must not affect print
    // visibility). Not-frozen employees always print; a frozen employee
    // prints only when include_in_print is strictly true.
    const printableEmployees = employees.filter(
        (e) => !e.is_frozen || e.include_in_print === true
    );

    printableEmployees.forEach((emp, index) => {
        const isUnpaid = emp.is_unpaid_leave === true;
        const monthlyRate = emp.over_45 ? 3.75 : 2.5;
        const ledger = computeYearlyLedger(emp, years, realLibyaYear, monthlyRate);

        html += `
            <tr>
                <td>${index + 1}</td>
                <td class="name-col">${escapeHtml(emp.name)}${emp.is_unpaid_leave ? ' <span style="color:#dc2626;font-size:0.8em;">(بدون مرتب)</span>' : ''}</td>
                <td style="text-align: center; direction: ltr;">${escapeHtml(emp.job_number) || '-'}</td>
                <td>${escapeHtml(emp.national_id) || '-'}</td>
                <td>${escapeHtml(emp.job_title) || '-'}</td>
        `;

        // Normal employees: a genuinely-zero added/deducted cell prints as
        // "-" (shorthand for "nothing yet"). An unpaid-leave employee's
        // zero is a deliberate override, not an absence of data, so it
        // must print as an unambiguous "0" instead.
        const cell = (v) => (v === 0 && !isUnpaid ? '-' : v);

        if (isAllYears) {
            ledger.forEach((row) => {
                html += `<td>${row.opening === 0 ? '0' : row.opening}</td>
                    <td>${cell(row.added)}</td>
                    <td>${cell(row.deducted)}</td>
                    <td>${row.closing}</td>`;
            });
        } else {
            const row = ledger.find(r => r.year === selectedYear);
            if (row) {
                html += `<td>${row.opening === 0 ? '0' : row.opening}</td>
                    <td>${cell(row.added)}</td>
                    <td>${cell(row.deducted)}</td>
                    <td>${row.closing}</td>`;
            }
        }

        html += `</tr>`;
    });

    html += `
            </tbody>
        </table>

        <div class="signatures">
            <div class="sig-col"><div class="sig-space"></div><p class="sig-text">مراجعة وحدة شؤون الموظفين</p></div>
            <div class="sig-col"><div class="sig-space"></div><p class="sig-text">اعتماد رئيس قسم الشؤون الإدارية</p></div>
            <div class="sig-col"><div class="sig-space"></div><p class="sig-text">اعتماد مدير مكتب أوقاف القره بوللي</p></div>
        </div>

        <div class="footer-note">تم انشاء هذا التقرير بواسطة منظومة الإجازات</div>

        <script>window.onload = function() { setTimeout(function(){ window.print(); }, 500); }<\/script>
    </body>
    </html>`;

    printWindow.document.write(html);
    printWindow.document.close();
}
