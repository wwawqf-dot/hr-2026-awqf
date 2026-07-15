import { formatDateDisplay } from './formatDate';
import { getLibyaTime } from './libyaTime';

// Computes an employee's current net cumulative balance the same way the
// main employees table does: initial carried-forward plus, for every tracked
// year, the added minus the deducted. Order is irrelevant for the total.
function computeNetCumulative(employee) {
    const initial = parseFloat(employee.initial_carried_forward) || 0;
    return Object.values(employee.years_data || {}).reduce(
        (acc, yd) => acc + (parseFloat(yd?.added) || 0) - (parseFloat(yd?.deducted) || 0),
        initial
    );
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Opens a print-ready A4 (portrait) window with an official detailed leave
// statement for a SINGLE employee: office header, employee identity block,
// net cumulative balance, the full deduction history table, and a signatures
// footer. Mirrors the styling of the annual report (printReport.js).
export function printEmployeeStatement(employee) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('يرجى السماح للنوافذ المنبثقة لطباعة كشف الحساب.');
        return;
    }

    const formattedDate = getLibyaTime().toLocaleDateString('ar-LY', {
        timeZone: 'Africa/Tripoli',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    const netCumulative = computeNetCumulative(employee);
    const history = employee.deductions_history || [];

    const rowsHtml = history.length === 0
        ? `<tr><td colspan="5" style="padding: 20px; color: #555; font-weight: 700;">لا توجد خصومات إجازة مسجلة لهذا الموظف.</td></tr>`
        : history
              .map((item, index) => {
                  const isUnknownDate = !item.start;
                  const datesCells = isUnknownDate
                      ? `<td colspan="2" style="font-style: italic; color: #444;">خصم بغير تاريخ</td>`
                      : `<td>${escapeHtml(formatDateDisplay(item.start))}</td>
                         <td>${escapeHtml(formatDateDisplay(item.end))}</td>`;
                  return `
                    <tr>
                        <td>${escapeHtml(item.year)}</td>
                        ${datesCells}
                        <td>${escapeHtml(item.days)}</td>
                        <td class="note-col">${escapeHtml(item.note || '—')}</td>
                    </tr>`;
              })
              .join('');

    const html = `
    <html dir="rtl" lang="ar">
    <head>
        <title>كشف تفصيلي بإجازات الموظف - ${escapeHtml(employee.name)}</title>
        <link href="${window.location.origin}/fonts/tajawal/tajawal.css" rel="stylesheet">
        <style>
            body { font-family: 'Tajawal', sans-serif; padding: 30px; color: #000; background: #fff; }
            .report-header { text-align: center; margin-bottom: 15px; line-height: 1.8; }
            .report-header h3 { margin: 0; font-size: 20px; font-weight: 800; }
            .report-header h2 { margin: 15px 0 10px 0; font-size: 24px; font-weight: 800; }
            .report-header p { margin: 0; font-size: 15px; }

            .employee-details {
                display: flex; flex-wrap: wrap; gap: 10px 40px;
                border: 2px solid #000; border-radius: 6px;
                padding: 16px 22px; margin-top: 20px; font-size: 15px;
            }
            .detail-item { flex: 1 1 40%; font-weight: 700; }
            .detail-item .label { font-weight: 800; color: #333; }

            .balance-summary {
                margin-top: 18px; text-align: center; font-size: 18px; font-weight: 800;
                border: 2px solid #000; border-radius: 6px; padding: 12px;
                background-color: #f2f2f2;
            }
            .balance-summary .value { font-size: 22px; }

            table { width: 100%; table-layout: auto; border-collapse: collapse; margin-top: 20px; font-size: 14px; text-align: center; }
            th, td { border: 2px solid #000; padding: 10px 5px; }
            th { font-weight: 800; background-color: #fff; }
            td { font-weight: 700; }
            td.note-col { text-align: right; padding-right: 12px; }

            .signatures { margin-top: 70px; display: flex; justify-content: space-between; text-align: center; padding: 0 20px; }
            .sig-block { flex: 1; display: flex; flex-direction: column; align-items: center; }
            .sig-role { margin: 0 0 45px 0; font-size: 14px; font-weight: 800; }
            .sig-space { width: 75%; height: 1px; border-bottom: 1.5px solid #000; margin-bottom: 8px; }
            .sig-title { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.3px; }

            .footer-note { margin-top: 50px; font-size: 12px; color: #333; text-align: right; font-weight: 500; }

            .statement-note {
                margin-top: 22px; padding: 12px 16px;
                border: 1.5px solid #000; border-radius: 6px;
                font-size: 13px; font-weight: 700; line-height: 1.9;
                text-align: right; background-color: #f7f7f7;
            }

            @media print {
                @page { margin: 12mm; size: A4 portrait; }
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 0; }
                .no-print { display: none; }
                table { border-collapse: collapse !important; border: 2px solid #000 !important; }
                th, td { border: 1px solid #000 !important; }
                tr > *:last-child { border-left: 2px solid #000 !important; }
                tr > *:first-child { border-right: 2px solid #000 !important; }
            }
        </style>
    </head>
    <body>
        <div class="no-print" style="margin-bottom: 20px; text-align: center;">
            <button onclick="window.print()" style="padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 5px; cursor: pointer; font-family: 'Tajawal'; font-size: 16px; font-weight: bold;">طباعة كشف الحساب الآن</button>
        </div>

        <div class="report-header">
            <h3>الهيئة العامة للأوقاف والشؤون الإسلامية</h3>
            <h3>مكتب أوقاف القره بوللي</h3>
            <h2>كشف تفصيلي بإجازات الموظف</h2>
            <p>تاريخ الإصدار: ${formattedDate}</p>
        </div>

        <hr style="border: 0; border-top: 3px solid #000; margin-bottom: 5px;">

        <div class="employee-details">
            <div class="detail-item"><span class="label">الإسم:</span> ${escapeHtml(employee.name)}</div>
            <div class="detail-item"><span class="label">الرقم الوظيفي:</span> ${escapeHtml(employee.job_number || '-')}</div>
            <div class="detail-item"><span class="label">الصفة الوظيفية:</span> ${escapeHtml(employee.job_title || '-')}</div>
            <div class="detail-item"><span class="label">الرقم الوطني:</span> ${escapeHtml(employee.national_id || '-')}</div>
        </div>

        <div class="balance-summary">
            الصافي التراكمي الحالي للرصيد: <span class="value">${netCumulative}</span> يوماً
        </div>

        <table>
            <thead>
                <tr>
                    <th style="width: 70px;">السنة</th>
                    <th>من تاريخ</th>
                    <th>إلى تاريخ</th>
                    <th style="width: 110px;">الأيام المخصومة</th>
                    <th style="min-width: 160px;">الملاحظات</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>

        <div class="statement-note">
            ملاحظة: بدأ العمل بالمنظومة آلياً بتاريخ 13/07/2026. الخصومات السابقة مسجلة كأرصدة مرحلة، وتفاصيلها محفوظة بملف الموظف الورقي.
        </div>

        <div class="signatures">
            <div class="sig-block">
                <p class="sig-role">إعداد</p>
                <div class="sig-space"></div>
                <p class="sig-title">وحدة شؤون الموظفين</p>
            </div>
            <div class="sig-block">
                <p class="sig-role">مراجعة</p>
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
            تم انشاء هذا الكشف بواسطة منظومة الإجازات
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
