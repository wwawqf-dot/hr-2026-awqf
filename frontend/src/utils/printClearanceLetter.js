import { formatDateDisplay } from './formatDate';
import { getLibyaTime } from './libyaTime';

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Opens a print-ready A4 formal clearance (إخلاء طرف) letter for an employee
// leaving via transfer or resignation, addressed to the destination entity,
// stating the mathematically settled final leave balance.
export function printClearanceLetter(employee, { destination, endServiceDate, finalBalance }) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('يرجى السماح للنوافذ المنبثقة لطباعة إخلاء الطرف.');
        return;
    }

    const printDate = getLibyaTime().toLocaleDateString('ar-LY', {
        timeZone: 'Africa/Tripoli',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    const endDisplay = endServiceDate ? formatDateDisplay(endServiceDate) : '................';
    const destinationText = destination && destination.trim() ? destination.trim() : '................';

    const html = `
    <html dir="rtl" lang="ar">
    <head>
        <title>إخلاء طرف - ${escapeHtml(employee.name)}</title>
        <link href="${window.location.origin}/fonts/tajawal/tajawal.css" rel="stylesheet">
        <style>
            body { font-family: 'Tajawal', sans-serif; padding: 40px 55px; color: #000; background: #fff; line-height: 2.1; font-size: 16px; }
            .letterhead { text-align: center; margin-bottom: 10px; line-height: 1.7; }
            .letterhead h3 { margin: 0; font-size: 18px; font-weight: 800; }
            .letterhead .date { margin-top: 6px; font-size: 13px; font-weight: 600; }
            hr.divider { border: 0; border-top: 2px solid #000; margin: 12px 0 22px; }

            .doc-title { text-align: center; font-size: 20px; font-weight: 800; text-decoration: underline; margin: 0 0 22px; }
            .recipient { font-weight: 800; font-size: 17px; margin: 0 0 4px; }
            .greeting { margin: 0 0 2px; font-weight: 700; }
            .body-par { margin: 16px 0 0; text-align: justify; }
            .body-par .var { font-weight: 800; }

            .balance-box {
                margin: 22px 0; padding: 14px 18px; text-align: center;
                border: 2px solid #000; border-radius: 6px; background-color: #f2f2f2;
                font-size: 18px; font-weight: 800;
            }
            .balance-box .value { font-size: 22px; }

            .signature { margin-top: 55px; text-align: center; }
            .signature .name { margin: 0; font-weight: 800; font-size: 16px; }
            .signature .role { margin: 4px 0 0; font-weight: 700; }

            @media print {
                @page { size: A4 portrait; margin: 14mm; }
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 0; width: 100%; }
                .no-print { display: none; }
            }
        </style>
    </head>
    <body>
        <div class="no-print" style="margin-bottom: 20px; text-align: center;">
            <button onclick="window.print()" style="padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 5px; cursor: pointer; font-family: 'Tajawal'; font-size: 16px; font-weight: bold;">طباعة إخلاء الطرف الآن</button>
        </div>

        <div class="letterhead">
            <h3>الهيئة العامة للأوقاف والشؤون الإسلامية</h3>
            <h3>مكتب أوقاف القره بوللي</h3>
            <div class="date">التاريخ: ${printDate}</div>
        </div>
        <hr class="divider">

        <h2 class="doc-title">إخلاء طرف وتسوية رصيد إجازات</h2>

        <p class="recipient">السادة/ ${escapeHtml(destinationText)}</p>
        <p class="greeting">السلام عليكم ورحمة الله وبركاته</p>
        <p class="greeting">تحية طيبة وبعد ،،،</p>

        <p class="body-par">
            بالإشارة إلى انتهاء خدمة الموظف/ <span class="var">${escapeHtml(employee.name)}</span>، الرقم الوظيفي (<span class="var">${escapeHtml(employee.job_number || '................')}</span>)، اعتباراً من تاريخ انقطاعه عن العمل الموافق <span class="var">${endDisplay}</span>م.
        </p>

        <p class="body-par">
            نفيدكم بأنه قد تمت تسوية رصيد إجازاته حسابياً حتى تاريخ انتهاء خدمته، وبهذا يكون رصيده النهائي من الإجازة المستحقة على النحو التالي:
        </p>

        <div class="balance-box">
            الرصيد النهائي المستحق: <span class="value">${finalBalance}</span> يوماً
        </div>

        <p class="body-par">
            وقد حُرِّر هذا الكتاب لإخلاء طرفه من هذا المكتب وإحالته إلى جهتكم الموقرة، فنأمل التكرم بالعلم واتخاذ ما يلزم.
        </p>

        <div class="signature">
            <p class="name">احمد مفتاح عبدالسلام المجدوب</p>
            <p class="role">رئيس قسم الشؤون الإدارية</p>
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
