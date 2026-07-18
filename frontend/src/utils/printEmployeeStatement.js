import { formatDateDisplay } from './formatDate.js';
import { getLibyaDisplayDate, getAccrualLabel, getAccruedDays, getLibyaYear } from './libyaTime.js';

function computeNetCumulative(employee) {
    if (employee.is_unpaid_leave) return 0;
    const currentYear = getLibyaYear();
    const monthlyRate = employee.over_45 ? 3.75 : 2.5;
    const initial = parseFloat(employee.initial_carried_forward) || 0;
    const yearsData = employee.years_data || {};
    let balance = initial;
    for (const [year, yd] of Object.entries(yearsData)) {
        balance += (parseFloat(yd?.added) || 0) - (parseFloat(yd?.deducted) || 0);
    }
    if (!yearsData[currentYear]) {
        balance += getAccruedDays(Number(currentYear), monthlyRate, employee.hire_date_current_year);
    }
    return balance;
}

function computePreviousCarryOver(employee, years) {
    if (employee.is_unpaid_leave) return 0;
    const currentYear = getLibyaYear();
    let carry = parseFloat(employee.initial_carried_forward) || 0;
    for (const y of years) {
        if (Number(y) >= Number(currentYear)) break;
        const yd = employee.years_data?.[y] || { added: 0, deducted: 0 };
        carry += (parseFloat(yd.added) || 0) - (parseFloat(yd.deducted) || 0);
    }
    return Math.max(0, carry);
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function printEmployeeStatement(employee) {
    const years = Object.keys(employee.years_data || {}).sort();
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('يرجى السماح للنوافذ المنبثقة لطباعة كشف الحساب.');
        return;
    }

    // Single Tripoli conversion from the real instant — see libyaTime.js;
    // getLibyaTime().toLocaleDateString(timeZone:...) double-converts.
    const formattedDate = getLibyaDisplayDate(new Date());
    const isUnpaid = employee.is_unpaid_leave === true;
    const netCumulative = computeNetCumulative(employee);
    const prevCarry = computePreviousCarryOver(employee, years);
    const monthlyRate = employee.over_45 ? 3.75 : 2.5;
    const accruedLabel = getAccrualLabel();
    // Explicit force-zero for an unpaid-leave employee: computeNetCumulative
    // and computePreviousCarryOver already guard themselves, but these two
    // summary figures were computed independently and did NOT check
    // is_unpaid_leave — so a frozen-at-zero employee's statement still
    // showed their real accrued days and real total deducted. Force both
    // to exactly 0 here, at the point they're prepared for the printout.
    const accruedDays = isUnpaid ? 0 : getAccruedDays(Number(getLibyaYear()), monthlyRate, employee.hire_date_current_year);
    const totalDeducted = isUnpaid ? 0 : Object.values(employee.years_data || {}).reduce((sum, yd) => sum + (parseFloat(yd?.deducted) || 0), 0);
    const history = employee.deductions_history || [];

    const rowsHtml = history.length === 0
        ? `<tr><td colspan="5" style="padding: 20px; color: #555; font-weight: 700;">لا توجد خصومات إجازة مسجلة لهذا الموظف.</td></tr>`
        : history.map((item) => {
            const isUnknownDate = !item.start;
            const datesCells = isUnknownDate
                ? `<td colspan="2" style="font-style: italic; color: #444;">خصم بغير تاريخ</td>`
                : `<td>${escapeHtml(formatDateDisplay(item.start))}</td><td>${escapeHtml(formatDateDisplay(item.end))}</td>`;
            return `<tr><td>${escapeHtml(item.year)}</td>${datesCells}<td>${escapeHtml(item.days)}</td><td class="note-col">${escapeHtml(item.note || '—')}</td></tr>`;
        }).join('');

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
            .employee-details { display: flex; flex-wrap: wrap; gap: 10px 40px; border: 2px solid #000; border-radius: 6px; padding: 16px 22px; margin-top: 20px; font-size: 15px; }
            .detail-item { flex: 1 1 40%; font-weight: 700; }
            .detail-item .label { font-weight: 800; color: #333; }
            .summary-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
            .summary-card { flex: 1 1 40%; border: 1.5px solid #000; border-radius: 6px; padding: 10px 14px; text-align: center; font-weight: 700; font-size: 14px; background: #f2f2f2; }
            .summary-card .val { font-size: 20px; display: block; margin-top: 4px; }
            .summary-card .val.green { color: #059669; }
            .summary-card .val.red { color: #dc2626; }
            .summary-card .val.blue { color: #2563eb; }
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
            .statement-note { margin-top: 22px; padding: 12px 16px; border: 1.5px solid #000; border-radius: 6px; font-size: 13px; font-weight: 700; line-height: 1.9; text-align: right; background-color: #f7f7f7; }
            @media print {
                @page { margin: 12mm; size: A4 portrait; }
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 0; }
                .no-print { display: none; }
                /* The deductions table + notes section must stay VISIBLE and
                   paginate normally on print — only the on-screen "print now"
                   button (.no-print, above) is hidden. */
                table { box-sizing: border-box !important; border-collapse: collapse !important; width: 98% !important; margin: 0 auto !important; border: 2px solid #000 !important; page-break-inside: auto !important; }
                tr { page-break-inside: avoid !important; }
                th, td { border: 1px solid #000 !important; padding: 8px !important; }
                .statement-note { page-break-inside: avoid !important; }
                .signatures { page-break-inside: avoid !important; }
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
            <div class="detail-item"><span class="label">الإسم:</span> ${escapeHtml(employee.name)} ${employee.is_unpaid_leave ? '<span style="color:#dc2626;font-weight:800;margin-right:8px;">(إجازة بدون مرتب)</span>' : ''}</div>
            <div class="detail-item"><span class="label">الرقم الوظيفي:</span> ${escapeHtml(employee.job_number || '-')}</div>
            <div class="detail-item"><span class="label">الصفة الوظيفية:</span> ${escapeHtml(employee.job_title || '-')}</div>
            <div class="detail-item"><span class="label">الرقم الوطني:</span> ${escapeHtml(employee.national_id || '-')}</div>
        </div>

        <!-- Summary-only cards -->
        <div class="summary-grid">
            <div class="summary-card">الرصيد المرحّل من السنوات السابقة<span class="val blue">${prevCarry}</span></div>
            <div class="summary-card">${accruedLabel}<span class="val green">${accruedDays}</span></div>
            <div class="summary-card">إجمالي المخصوم<span class="val red">${totalDeducted}</span></div>
            <div class="summary-card">الصافي التراكمي الحالي<span class="val green">${netCumulative}</span></div>
        </div>

        <div class="statement-body">
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
                <tbody>${rowsHtml}</tbody>
            </table>

            <div class="statement-note">
                ملاحظة: بدأ العمل بالمنظومة آلياً بتاريخ 13/07/2026. الخصومات السابقة مسجلة كأرصدة مرحلة، وتفاصيلها محفوظة بملف الموظف الورقي.
            </div>
        </div>

        <div class="signatures">
            <div class="sig-block"><p class="sig-role">إعداد</p><div class="sig-space"></div><p class="sig-title">وحدة شؤون الموظفين</p></div>
            <div class="sig-block"><p class="sig-role">اعتماد</p><div class="sig-space"></div><p class="sig-title">&nbsp;</p></div>
            <div class="sig-block"><p class="sig-role">اعتماد</p><div class="sig-space"></div><p class="sig-title">مدير مكتب أوقاف القره بوللي</p></div>
        </div>

        <div class="footer-note">تم انشاء هذا الكشف بواسطة منظومة الإجازات</div>

        <script>window.onload = function() { setTimeout(function(){ window.print(); }, 500); }<\/script>
    </body>
    </html>`;

    printWindow.document.write(html);
    printWindow.document.close();
}
