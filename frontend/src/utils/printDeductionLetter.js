import { formatDateDisplay } from './formatDate';
import { getWeekendDays } from './deductionDays';

// Parses 'YYYY-MM-DD' as a LOCAL-midnight Date (never UTC) so date math
// stays correct on any timezone. Returns null for empty/invalid input.
function parseLocalDate(str) {
    if (!str || typeof str !== 'string') return null;
    const parts = str.split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    const [y, m, d] = parts;
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// The employee's return-to-work date: the day AFTER the leave ends, skipping
// the weekend days that apply to their job title so they resume on a working
// day. Returns a DD/MM/YYYY string (no weekday name), or '' if no end date.
function computeReturnDate(endStr, jobTitle) {
    const end = parseLocalDate(endStr);
    if (!end) return '';
    const weekend = getWeekendDays(jobTitle);
    const next = new Date(end);
    next.setDate(next.getDate() + 1);
    let guard = 0;
    while (weekend.includes(next.getDay()) && guard < 14) {
        next.setDate(next.getDate() + 1);
        guard++;
    }
    return formatDateDisplay(toISO(next));
}

// Current net cumulative balance = initial carried-forward + Σ(added - deducted).
function computeNetBalance(employee) {
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

// Opens a print-ready A4 formal leave-notification letter for one specific
// deduction record of an employee.
export function printDeductionLetter(employee, deduction) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('يرجى السماح للنوافذ المنبثقة لطباعة الإشعار.');
        return;
    }

    // Accept either the API-aliased fields (start/end) or the raw column names
    // (start_date/end_date) so the dates never render blank due to shape.
    const startRaw = deduction.start || deduction.start_date || '';
    const endRaw = deduction.end || deduction.end_date || '';
    const startDisplay = startRaw ? formatDateDisplay(startRaw) : '................';
    const returnDate = computeReturnDate(endRaw, employee.job_title) || '................';
    const netBalance = computeNetBalance(employee);
    // Past cumulative balance still being consumed => 2025; otherwise the
    // employee is drawing from the current year's addition => 2026.
    const yearString = (parseFloat(employee.initial_carried_forward) || 0) > 0 ? '2025' : '2026';

    const html = `
    <html dir="rtl" lang="ar">
    <head>
        <title>إشعار خصم إجازة - ${escapeHtml(employee.name)}</title>
        <link href="${window.location.origin}/fonts/tajawal/tajawal.css" rel="stylesheet">
        <style>
            body { font-family: 'Tajawal', sans-serif; padding: 40px 55px; color: #000; background: #fff; line-height: 2.1; font-size: 16px; }
            .letter-container { box-sizing: border-box; width: 100%; max-width: 100%; }

            .recipient { font-weight: 800; font-size: 17px; margin: 0 0 4px; }
            .greeting { margin: 0 0 2px; font-weight: 700; }
            .job-number { margin: 18px 0; font-weight: 800; }
            .body-par { margin: 0 0 16px; text-align: justify; }
            .body-par .var { font-weight: 800; }

            .signature { margin-top: 55px; text-align: center; }
            .signature .name { margin: 0; font-weight: 800; font-size: 16px; }
            .signature .role { margin: 4px 0 0; font-weight: 700; }

            .cc { margin-top: 45px; font-size: 14px; font-weight: 600; }
            .cc ul { margin: 8px 0 0; padding-inline-start: 22px; }
            .cc li { margin-bottom: 3px; }

            @media print {
                @page { size: A4 portrait; margin: 14mm; }
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 0; width: 100%; }
                .no-print { display: none; }
                /* Printing on physical pre-printed letterhead: push the text
                   down so it starts below the printed letterhead design, and
                   keep every line strictly inside the A4 margins so RTL text
                   is never clipped on the left edge. */
                .letter-container {
                    margin-top: 6cm !important;
                    width: 100% !important;
                    max-width: 100% !important;
                    box-sizing: border-box !important;
                    padding-left: 25px !important;
                    padding-right: 25px !important;
                    word-wrap: break-word !important;
                    overflow-wrap: break-word !important;
                }
            }
        </style>
    </head>
    <body>
        <div class="no-print" style="margin-bottom: 20px; text-align: center;">
            <button onclick="window.print()" style="padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 5px; cursor: pointer; font-family: 'Tajawal'; font-size: 16px; font-weight: bold;">طباعة الإشعار الآن</button>
        </div>

        <div class="letter-container">
            <p class="recipient">السيد/ مدير الشؤون الإدارية والمالية بالهيئة العامة للأوقاف والشؤون الإسلامية</p>
            <p class="greeting">السلام عليكم ورحمة الله وبركاته</p>
            <p class="greeting">تحية طيبة وبعد ،،،</p>

            <p class="job-number">الرقم الوظيفي: <span>${escapeHtml(employee.job_number || '................')}</span></p>

            <p class="body-par">ففي الوقت الذي نثمن فيه جهودكم المبذولة في خدمة الصالح العام.</p>

            <p class="body-par">
                بالإشارة إلى طلب الموظف/ <span class="var">${escapeHtml(employee.name)}</span> والذي ضمنه رغبته في الحصول على إجازة سنوية مدتها (<span class="var">${escapeHtml(deduction.days)}</span> يوم) اعتبارا من تاريخ <span class="var">${startDisplay}</span>م.
            </p>

            <p class="body-par">
                عـلـيـه، نفيدكم بأنه تم خصم المدة المطلوبة من رصيد الإجازات على أن تكون عودة المعني للعمل بتاريخ <span class="var">${returnDate}</span>م، وبهذا يكون رصيدكم من الإجازة حتى تاريخ 31 ديسمبر <span class="var">${yearString}</span>م، هو (<span class="var">${netBalance}</span> يوم).
            </p>

            <div class="signature">
                <p class="name">احمد مفتاح عبدالسلام المجدوب</p>
                <p class="role">رئيس قسم الشؤون الإدارية</p>
            </div>

            <div class="cc">
                صورة إلى :-
                <ul>
                    <li>مكتب رئيس الهيئة - وحدة شؤون المكتب.</li>
                    <li>قسم المتابعة بالمكتب.</li>
                    <li>وحدة شؤون الموظفين بالمكتب.</li>
                    <li>الملف الشخصي.</li>
                    <li>الملف الدوري العام.</li>
                </ul>
            </div>
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
