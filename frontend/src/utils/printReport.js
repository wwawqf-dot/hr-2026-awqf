import { formatDateDisplay } from './formatDate';
import { getLibyaTime } from './libyaTime';

// Ported from the original standalone HTML file's generateReport(), kept
// pixel-identical for the printed output while sourcing data from the
// React app's state instead of the old localStorage-backed globals.
export function printReport(selectedYear, years, employees, openingBalanceDate) {
    const isAllYears = selectedYear === 'all';
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('يرجى السماح للنوافذ المنبثقة لطباعة التقرير.');
        return;
    }

    const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = getLibyaTime().toLocaleDateString('ar-LY', { ...dateOptions, timeZone: 'Africa/Tripoli' });
    const carriedLabel = `المرحل حتى ${formatDateDisplay(openingBalanceDate)}`;

    // The comprehensive report grows by 3 columns per financial year, so a
    // fixed font size either wastes space (one year) or overflows the page
    // (many years). Scale it down as the column count grows instead.
    const fixedColumnCount = 4; // #, name, national id, job title
    const yearColumnCount = isAllYears ? 1 + years.length * 3 : 4;
    const totalColumnCount = fixedColumnCount + yearColumnCount;

    let tableFontSize = 14;
    let cellPadding = '10px 5px';
    if (totalColumnCount > 16) {
        tableFontSize = 10;
        cellPadding = '6px 3px';
    } else if (totalColumnCount > 12) {
        tableFontSize = 11;
        cellPadding = '7px 4px';
    } else if (totalColumnCount > 9) {
        tableFontSize = 12;
        cellPadding = '8px 4px';
    }

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

            .signatures { margin-top: 70px; display: flex; justify-content: space-between; text-align: center; padding: 0 20px; }
            .sig-block { flex: 1; display: flex; flex-direction: column; align-items: center; }
            .sig-role { margin: 0 0 45px 0; font-size: 14px; font-weight: 800; }
            .sig-space { width: 75%; height: 1px; border-bottom: 1.5px solid #000; margin-bottom: 8px; }
            .sig-title { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.3px; }

            .footer-note { margin-top: 50px; font-size: 12px; color: #333; text-align: right; font-weight: 500; }

            @media print {
                @page { size: A4 landscape; margin: 10mm; }
                body {
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                    width: 100%;
                    padding: 0;
                    box-sizing: border-box !important;
                }
                .no-print { display: none; }

                /* ===== Table container: prevent side-bleed ===== */
                table {
                    box-sizing: border-box !important;
                    border-collapse: collapse !important;
                    width: 98% !important;
                    margin: 0 auto !important;
                    border: 2px solid #000 !important;
                }
                th, td {
                    border: 1px solid #000 !important;
                    padding: 8px !important;
                }
                /* Keep table rows and the signatures block intact so a row or
                   the signatures never break alone onto an empty trailing page. */
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
                    <th style="min-width: 150px;">الاسم</th>
                    <th>الوطني</th>
                    <th>الصفة</th>
    `;

    if (isAllYears) {
        html += `<th>${carriedLabel}</th>`;
        years.forEach((year) => {
            html += `<th>مضاف ${year}</th><th>مخصوم ${year}</th><th>الصافي التراكمي ${year}</th>`;
        });
    } else {
        html += `
            <th>${carriedLabel}</th>
            <th>مضاف ${selectedYear}</th>
            <th>مخصوم ${selectedYear}</th>
            <th>الصافي التراكمي ${selectedYear}</th>
        `;
    }

    html += `</tr></thead><tbody>`;

    employees.forEach((emp, index) => {
        const initialCarried = parseFloat(emp.initial_carried_forward) || 0;

        html += `
            <tr>
                <td>${index + 1}</td>
                <td class="name-col">${emp.name}</td>
                <td>${emp.national_id || '-'}</td>
                <td>${emp.job_title || '-'}</td>
        `;

        if (isAllYears) {
            html += `<td>${initialCarried === 0 ? '0' : initialCarried}</td>`;
            let runningNet = initialCarried;

            years.forEach((year) => {
                const added = parseFloat(emp.years_data[year]?.added) || 0;
                const deducted = parseFloat(emp.years_data[year]?.deducted) || 0;
                runningNet = runningNet + added - deducted;

                html += `
                    <td>${added === 0 ? '-' : added}</td>
                    <td>${deducted === 0 ? '-' : deducted}</td>
                    <td>${runningNet}</td>
                `;
            });
        } else {
            let carriedForSelectedYear = initialCarried;
            for (const y of years) {
                if (y === selectedYear) break;
                carriedForSelectedYear += (parseFloat(emp.years_data[y]?.added) || 0) - (parseFloat(emp.years_data[y]?.deducted) || 0);
            }

            const added = parseFloat(emp.years_data[selectedYear]?.added) || 0;
            const deducted = parseFloat(emp.years_data[selectedYear]?.deducted) || 0;
            const net = carriedForSelectedYear + added - deducted;

            html += `
                <td>${carriedForSelectedYear === 0 ? '0' : carriedForSelectedYear}</td>
                <td>${added === 0 ? '-' : added}</td>
                <td>${deducted === 0 ? '-' : deducted}</td>
                <td>${net}</td>
            `;
        }

        html += `</tr>`;
    });

    html += `
            </tbody>
        </table>

        <div class="signatures">
            <div class="sig-block">
                <p class="sig-role">إعداد</p>
                <div class="sig-space"></div>
                <p class="sig-title">رئيس وحدة شؤون الموظفين</p>
            </div>
            <div class="sig-block">
                <p class="sig-role">&nbsp;</p>
                <div class="sig-space"></div>
                <p class="sig-title">رئيس قسم الشؤون الإدارية</p>
            </div>
            <div class="sig-block">
                <p class="sig-role">اعتماد</p>
                <div class="sig-space"></div>
                <p class="sig-title">مدير مكتب أوقاف القره بوللي</p>
            </div>
        </div>

        <div class="footer-note">
            تم انشاء هذا التقرير بواسطة منظومة الإجازات
        </div>

        <script>
            window.onload = function() { setTimeout(function(){ window.print(); }, 500); }
        <\/script>
    </body>
    </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
}
