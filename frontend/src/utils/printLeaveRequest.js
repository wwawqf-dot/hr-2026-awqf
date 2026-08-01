import { daysToArabicWords, numberToArabicWords } from './arabicNumberWords.js';
import { getLastDayPrevMonthStr, getLibyaDisplayDate } from './libyaTime.js';

// The official "نموذج إجازة سنوية" form: an A4 SVG (595.2 × 841.92 pt) holding
// the printed form as a background image plus 26 `{{token}}` text placeholders.
const TEMPLATE_PATH = 'leave-template-v2.svg';
// Tajawal is the only Arabic face bundled with the app. The template was
// authored against fonts (Myriad Pro / thmanyah serif) that no browser has, so
// every text node is re-pointed at Tajawal — embedded as a data URI so the SVG
// stays self-contained when rasterised to PNG (a canvas render does not resolve
// external @font-face URLs).
// The bold cut, not the regular one: only a single weight gets embedded, so
// asking for bold against a 500-weight file would fall back to the browser's
// synthetic smearing — which rasterises badly in the PNG export.
const FONT_PATH = 'fonts/tajawal/tajawal-700-arabic.woff2';

function asset(path) {
    // Vite's BASE_URL carries the GitHub Pages sub-path ('/hr-2026-awqf/') in
    // production and '/' in dev, and always ends with a slash.
    return `${import.meta.env.BASE_URL}${path}`;
}

// Placeholders are keyed by POSITION, not by token name: the template reuses
// the same names for different fields ({{11}} is both the start and end day,
// {{33}} is the day of all three "إلى غاية" dates), so names alone are
// ambiguous. `dx` is half the placeholder's own rendered width, which recentres
// the value over the blank the designer sized for it.
//
// `maxW` is how wide the value may grow before it would run past the blank and
// over the form's own printed labels — measured off the background scan as
// twice the smaller distance from the anchor to either end of the blank, so a
// centred value stays inside it. Anything longer gets condensed to fit (see
// fitToBlanks); this is what keeps a six-part name or a long job title from
// printing on top of "الوظيفة".
//
// Date blanks read right-to-left on the paper — rightmost box is the day, then
// the month, with the year leftmost (matching the pre-printed "14هـ"/"20م"
// year markers elsewhere on the sheet).
const FIELDS = {
    '110.5,101.56':  { key: 'jobNumber',      dx: 21.6, size: 11.42, maxW: 120 },
    '334.2,144.61':  { key: 'employeeName',   dx: 48.4, size: 11.42, maxW: 252 },
    '110.82,144.61': { key: 'jobTitle',       dx: 30.0, size: 11.42, maxW: 155 },
    '419.9,186.2':   { key: 'leaveDays',      dx: 36.3, size: 11.42, maxW: 118 },
    '151.13,186.2':  { key: 'leaveDaysWords', dx: 45.5, size: 11.42, maxW: 156 },

    // تاريخ بدء الإجازة
    '455.75,207.86': { key: 'startDay',       dx: 10.4, size: 11.42 },
    '425.4,207.86':  { key: 'startMonth',     dx: 10.4, size: 11.42 },
    '365.49,207.86': { key: 'startYear',      dx: 16.5, size: 11.42 },
    // تاريخ انتهاء الإجازة
    '248.05,207.86': { key: 'endDay',         dx: 10.4, size: 11.42 },
    '217.7,207.86':  { key: 'endMonth',       dx: 10.4, size: 11.42 },
    '157.79,207.86': { key: 'endYear',        dx: 16.5, size: 11.42 },

    // إجمالي الإجازة المستحقة ( رقم ) بالحروف ..... إلى غاية ../../..
    '400.66,644.26': { key: 'entitledNum',    dx: 14.1, size: 10.08 },
    '254.3,638.43':  { key: 'entitledWords',  dx: 45.5, size: 11.42, maxW: 136 },
    '170.57,640.21': { key: 'cutoffDay',      dx: 13.0, size: 11.42 },
    '134.73,640.21': { key: 'cutoffMonth',    dx: 14.7, size: 11.42 },
    '74.95,640.21':  { key: 'cutoffYear',     dx: 23.2, size: 11.42 },

    // مدة الإجازة المطلوبة
    '412.72,665.32': { key: 'requestedNum',   dx: 14.1, size: 10.08 },
    '262.34,658.93': { key: 'requestedWords', dx: 45.5, size: 11.42, maxW: 138 },
    '177.41,658.93': { key: 'cutoffDay',      dx: 13.0, size: 11.42 },
    '141.57,658.93': { key: 'cutoffMonth',    dx: 14.7, size: 11.42 },
    '81.79,658.93':  { key: 'cutoffYear',     dx: 23.2, size: 11.42 },

    // الرصيد المتبقي
    '428.98,684.39': { key: 'remainingNum',   dx: 14.1, size: 10.08 },
    '269.26,679.51': { key: 'remainingWords', dx: 48.4, size: 11.42, maxW: 150 },
    '184.76,679.56': { key: 'cutoffDay',      dx: 13.0, size: 11.42 },
    '148.92,679.56': { key: 'cutoffMonth',    dx: 14.7, size: 11.42 },
    '89.14,679.56':  { key: 'cutoffYear',     dx: 23.2, size: 11.42 },
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
 * Placeholders with no value are dropped so the blank prints empty instead of
 * showing the raw token.
 */
function buildSvg(svgText, values, fontDataUri) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;

    if (svg.querySelector('parsererror')) throw new Error('ملف القالب تالف أو غير صالح');

    for (const el of Array.from(doc.querySelectorAll('text'))) {
        if (!/^\{\{[A-Za-z0-9_]+\}\}$/.test((el.textContent || '').trim())) continue;

        const translate = (el.getAttribute('transform') || '')
            .match(/translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/);
        if (!translate) { el.remove(); continue; }

        const cfg = FIELDS[`${translate[1]},${translate[2]}`];
        const raw = cfg && values[cfg.key];
        const value = raw == null ? '' : String(raw).trim();
        if (!cfg || !value) { el.remove(); continue; }

        el.removeAttribute('transform');
        el.setAttribute('x', (parseFloat(translate[1]) + cfg.dx).toFixed(2));
        el.setAttribute('y', parseFloat(translate[2]).toFixed(2));
        el.setAttribute('text-anchor', 'middle');
        el.setAttribute('direction', 'rtl');
        el.setAttribute('class', 'filled');
        el.setAttribute('style', `font-size:${cfg.size}px`);
        if (cfg.maxW) el.dataset.maxw = String(cfg.maxW);
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
      text.filled { fill: #000000; font-weight: 700; }
    `;
    svg.insertBefore(style, svg.firstChild);

    return svg;
}

/**
 * Condense any value that outgrew its blank. Text length can only be measured
 * once the SVG is in a rendered document with the font applied, so the sheet is
 * mounted off-screen for the measurement pass and detached again afterwards.
 */
async function fitToBlanks(svg) {
    const holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:absolute;left:-10000px;top:0;width:600px;visibility:hidden';
    holder.appendChild(svg);
    document.body.appendChild(holder);

    try {
        // Without this the embedded face may still be loading and every
        // measurement comes back as the fallback font's width.
        if (document.fonts && document.fonts.ready) await document.fonts.ready;

        for (const el of Array.from(svg.querySelectorAll('text.filled[data-maxw]'))) {
            const maxW = parseFloat(el.dataset.maxw);
            const width = el.getComputedTextLength();
            if (width > maxW) {
                el.setAttribute('textLength', maxW.toFixed(2));
                el.setAttribute('lengthAdjust', 'spacingAndGlyphs');
            }
            delete el.dataset.maxw;
        }
    } finally {
        holder.remove();
    }

    return new XMLSerializer().serializeToString(svg);
}

/**
 * Build the finished form as an SVG string, ready to print or rasterise.
 */
export async function renderLeaveRequestSvg(data) {
    const [template, fontDataUri] = await Promise.all([
        fetchText(asset(TEMPLATE_PATH)),
        fetchFontDataUri(asset(FONT_PATH)),
    ]);
    return fitToBlanks(buildSvg(template, data, fontDataUri));
}

// 'YYYY-MM-DD' → { day, month, year }; empty parts for a missing date.
function splitIsoDate(iso) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return parts ? { year: parts[1], month: parts[2], day: parts[3] } : { year: '', month: '', day: '' };
}

/**
 * Map a saved deduction onto the form's fields.
 *
 * @param {object} employee            the employee the leave belongs to
 * @param {object} deduction           { days, start, end, note }
 * @param {number} entitledBeforeDays  net balance *before* this deduction
 */
export function buildLeaveRequestValues(employee, deduction, entitledBeforeDays) {
    const requested = Number(deduction.days) || 0;
    const entitled = Number(entitledBeforeDays) || 0;
    const remaining = entitled - requested;

    const start = splitIsoDate(deduction.start);
    const end = splitIsoDate(deduction.end);
    // "إلى غاية" — the accrual cut-off, i.e. the last day of the month that has
    // just closed, in Libya's timezone. Same helper the balance labels use.
    const [cutoffDay, cutoffMonth, cutoffYear] = getLastDayPrevMonthStr().split('/');

    return {
        jobNumber: employee.job_number || '',
        employeeName: employee.name || '',
        jobTitle: employee.job_title || '',
        leaveDays: requested ? String(requested) : '',
        leaveDaysWords: daysToArabicWords(requested),

        startDay: start.day, startMonth: start.month, startYear: start.year,
        endDay: end.day, endMonth: end.month, endYear: end.year,

        entitledNum: String(entitled),
        entitledWords: numberToArabicWords(entitled),
        requestedNum: String(requested),
        requestedWords: numberToArabicWords(requested),
        remainingNum: String(remaining),
        remainingWords: numberToArabicWords(remaining),

        cutoffDay, cutoffMonth, cutoffYear,
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
