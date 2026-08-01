import { daysToArabicWords, numberToArabicWords } from './arabicNumberWords.js';
import { getLibyaDisplayDate } from './libyaTime.js';

// The official "نموذج إجازة سنوية" form. It is an A4 SVG (595.2 × 841.92 pt)
// holding the scanned form as a background image plus 11 `{{token}}` text
// placeholders that we fill in below.
const TEMPLATE_PATH = 'leave-template.svg';
// Tajawal is the only Arabic face bundled with the app. The template was
// authored against fonts (Myriad Pro / thmanyah serif) that no browser has, so
// every text node is re-pointed at Tajawal — embedded as a data URI so the SVG
// stays self-contained when rasterised to PNG (a canvas render does not resolve
// external @font-face URLs).
const FONT_PATH = 'fonts/tajawal/tajawal-500-arabic.woff2';

function asset(path) {
    // Vite's BASE_URL carries the GitHub Pages sub-path ('/hr-2026-awqf/') in
    // production and '/' in dev, and always ends with a slash.
    return `${import.meta.env.BASE_URL}${path}`;
}

// Placeholder → where it sits on the form. `dx` nudges the anchor to the centre
// of the blank: the template was laid out left-to-right around the literal
// `{{token}}` string, so the midpoint is roughly half that token's width.
const FIELDS = {
    th1:            { dx: 20, size: 11.42 }, // الرقم الوظيفي
    employee_name:  { dx: 48, size: 11.42 }, // الاسم الرباعي
    job_title:      { dx: 37, size: 11.42 }, // الوظيفة
    leave_days:     { dx: 40, size: 11.42 }, // مدة الإجازة (يوم/أيام)
    leave_22days:   { dx: 46, size: 11.42 }, // مدة الإجازة بالحروف
    '22days':       { dx: 25, size: 10.08 }, // إجمالي الإجازة المستحقة — رقماً
    leave_88days:   { dx: 46, size: 11.42 }, // إجمالي الإجازة المستحقة — بالحروف
    '33days':       { dx: 25, size: 10.08 }, // مدة الإجازة المطلوبة — رقماً
    leave_99days:   { dx: 46, size: 11.42 }, // مدة الإجازة المطلوبة — بالحروف
    '55days':       { dx: 25, size: 10.08 }, // الرصيد المتبقي — رقماً
    leave_977days:  { dx: 48, size: 11.42 }, // الرصيد المتبقي — بالحروف
};

function escapeXml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`تعذر تحميل ملف القالب (${res.status})`);
    return res.text();
}

async function fetchFontDataUri(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`تعذر تحميل الخط (${res.status})`);
    const buf = await res.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return `data:font/woff2;base64,${btoa(binary)}`;
}

/**
 * Swap each `{{token}}` text node for the real value, re-anchored and re-fonted,
 * and embed the font so the result stands alone.
 *
 * Parsed as a document rather than string-replaced: Illustrator splits a single
 * label across several <tspan>s to apply kerning (`{{th` + `1` + `}}`), so the
 * token only exists in the element's combined textContent, never in the markup.
 * Tokens with no value are dropped so the blank line prints empty instead of
 * showing the raw placeholder.
 */
function buildSvg(svgText, values, fontDataUri) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;

    if (svg.querySelector('parsererror')) throw new Error('ملف القالب تالف أو غير صالح');

    for (const el of Array.from(doc.querySelectorAll('text'))) {
        const token = (el.textContent || '').trim().match(/^\{\{([A-Za-z0-9_]+)\}\}$/);
        if (!token) continue;

        const cfg = FIELDS[token[1]];
        const raw = values[token[1]];
        const value = raw == null ? '' : String(raw).trim();
        if (!cfg || !value) { el.remove(); continue; }

        const translate = (el.getAttribute('transform') || '')
            .match(/translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/);
        if (!translate) { el.remove(); continue; }

        el.removeAttribute('transform');
        el.setAttribute('x', (parseFloat(translate[1]) + cfg.dx).toFixed(2));
        el.setAttribute('y', parseFloat(translate[2]).toFixed(2));
        el.setAttribute('text-anchor', 'middle');
        el.setAttribute('direction', 'rtl');
        el.setAttribute('class', 'filled');
        el.setAttribute('style', `font-size:${cfg.size}px`);
        el.textContent = value; // drops the kerning tspans along with the token
    }

    const style = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `
      @font-face {
        font-family: 'TajawalEmbedded';
        src: url(${fontDataUri}) format('woff2');
        font-weight: 400 800;
      }
      text, tspan { font-family: 'TajawalEmbedded', 'Tajawal', sans-serif; }
      text.filled { fill: #0b3d2e; font-weight: 600; }
    `;
    svg.insertBefore(style, svg.firstChild);

    return new XMLSerializer().serializeToString(doc);
}

/**
 * Build the finished form as an SVG string, ready to print or rasterise.
 * @param {object} data see buildLeaveRequestValues below
 */
export async function renderLeaveRequestSvg(data) {
    const [template, fontDataUri] = await Promise.all([
        fetchText(asset(TEMPLATE_PATH)),
        fetchFontDataUri(asset(FONT_PATH)),
    ]);
    return buildSvg(template, data, fontDataUri);
}

/**
 * Map a saved deduction onto the form's placeholders.
 *
 * @param {object} employee            the employee the leave belongs to
 * @param {object} deduction           { days, start, end, note }
 * @param {number} entitledBeforeDays  net balance *before* this deduction
 */
export function buildLeaveRequestValues(employee, deduction, entitledBeforeDays) {
    const requested = Number(deduction.days) || 0;
    const entitled = Number(entitledBeforeDays) || 0;
    const remaining = entitled - requested;

    return {
        th1: employee.job_number || '',
        employee_name: employee.name || '',
        job_title: employee.job_title || '',
        leave_days: requested ? String(requested) : '',
        leave_22days: daysToArabicWords(requested),
        '22days': String(entitled),
        leave_88days: numberToArabicWords(entitled),
        '33days': String(requested),
        leave_99days: numberToArabicWords(requested),
        '55days': String(remaining),
        leave_977days: numberToArabicWords(remaining),
    };
}

function safeFileName(employee) {
    const name = String(employee.name || 'موظف').replace(/[\\/:*?"<>|]/g, '').trim();
    return `طلب-إجازة-${name}-${getLibyaDisplayDate(new Date()).replace(/\//g, '-')}`;
}

/**
 * Open the filled form in a new tab and trigger the browser's print dialog,
 * where the user can either print or "Save as PDF". Mirrors the approach used
 * by printEmployeeStatement / printReport.
 */
export async function printLeaveRequest(employee, deduction, entitledBeforeDays) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('يرجى السماح للنوافذ المنبثقة لطباعة طلب الإجازة.');
        return;
    }

    let svg;
    try {
        svg = await renderLeaveRequestSvg(
            buildLeaveRequestValues(employee, deduction, entitledBeforeDays)
        );
    } catch (err) {
        printWindow.close();
        throw err;
    }

    printWindow.document.write(`<!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="utf-8">
      <title>${escapeXml(safeFileName(employee))}</title>
      <style>
        html, body { margin: 0; padding: 0; background: #525659; }
        .sheet { width: 210mm; height: 297mm; margin: 12px auto; background: #fff; box-shadow: 0 0 12px rgba(0,0,0,.4); }
        .sheet svg { width: 100%; height: 100%; display: block; }
        .toolbar { text-align: center; padding: 14px; font-family: system-ui, sans-serif; }
        .toolbar button { padding: 10px 22px; background: #10b981; color: #fff; border: 0;
                          border-radius: 6px; font-size: 15px; font-weight: 700; cursor: pointer; }
        @media print {
          @page { size: A4 portrait; margin: 0; }
          html, body { background: #fff; }
          .toolbar { display: none; }
          .sheet { margin: 0; box-shadow: none; width: 100%; height: auto; }
        }
      </style>
    </head>
    <body>
      <div class="toolbar"><button onclick="window.print()">طباعة الطلب الآن</button></div>
      <div class="sheet">${svg}</div>
      <script>window.onload = function () { setTimeout(function () { window.print(); }, 600); }<\/script>
    </body>
    </html>`);
    printWindow.document.close();
}

/**
 * Rasterise the filled form and save it straight to disk as a PNG — no print
 * dialog. Safe from canvas tainting because both the background image and the
 * font are inlined as data URIs and the SVG itself is loaded from a blob URL.
 */
export async function downloadLeaveRequestImage(employee, deduction, entitledBeforeDays) {
    const svg = await renderLeaveRequestSvg(
        buildLeaveRequestValues(employee, deduction, entitledBeforeDays)
    );

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    try {
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('تعذر تجهيز صورة الطلب'));
            el.src = url;
        });

        // Match the background scan's native resolution (2480 × 3508 = A4 @300dpi).
        const canvas = document.createElement('canvas');
        canvas.width = 2480;
        canvas.height = 3508;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!pngBlob) throw new Error('تعذر إنشاء ملف الصورة');

        const pngUrl = URL.createObjectURL(pngBlob);
        const link = document.createElement('a');
        link.href = pngUrl;
        link.download = `${safeFileName(employee)}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(pngUrl);
    } finally {
        URL.revokeObjectURL(url);
    }
}
