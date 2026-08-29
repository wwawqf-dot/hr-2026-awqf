import ExcelJS from 'exceljs';
import { getLibyaDateStr, getLibyaYear } from './libyaTime.js';
import { computeYearlyLedger } from './leaveCalc.js';

// Export modelled on the office's own "أرصدة الإجازات — احترافي" workbook:
// the same four sheets, the same navy/amber palette, the same three-row
// header with the financial year banded above each مضاف/مخصوم pair.
//
// ONE DELIBERATE DEPARTURE FROM THAT TEMPLATE. The original computes each
// employee's entitlement inside Excel — it reads the birth year out of
// digits 2-5 of the national ID, compares it against an age threshold on
// the settings sheet, and picks 30 or 45. That is a second, independent
// engine, and it disagrees with this system on both inputs: entitlement
// here follows the over_45 flag an admin sets per employee, not an age
// derived from an ID, and it is released in two half-year installments
// after each six months are served rather than in one annual lump.
//
// Shipping those formulas would put a second set of numbers in front of
// the same admin and let a spreadsheet quietly overrule the database. So
// every per-employee figure below is written as a VALUE, straight from
// the same computeYearlyLedger() the on-screen table renders. What stays
// live is the arithmetic that cannot disagree: the totals, averages and
// per-title breakdowns on the dashboard, which sum the values above them.

const NAVY = 'FF1E3A5F';
const NAVY_LIGHT = 'FF2E5C8A';
const AMBER = 'FFFFF6CC';
const GREY = 'FFF7F7F7';
const BLUE_TINT = 'FFF2F6FA';
const NUM_FMT = '#,##0.00;[RED](#,##0.00);-';

const thin = {
    top: { style: 'thin', color: { argb: 'FFD6DEE7' } },
    left: { style: 'thin', color: { argb: 'FFD6DEE7' } },
    bottom: { style: 'thin', color: { argb: 'FFD6DEE7' } },
    right: { style: 'thin', color: { argb: 'FFD6DEE7' } },
};

const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

function headerCell(cell, bg = NAVY) {
    cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(bg);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thin;
}

function titleCell(cell, text, size = 14) {
    cell.value = text;
    cell.font = { name: 'Arial', bold: true, size, color: { argb: NAVY } };
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
}

// A leading apostrophe would show up in the cell, and a plain number
// drops the leading zeros a Libyan national ID never has but a job
// number sometimes does. Text format keeps both intact.
function idCell(cell, value) {
    cell.value = value || '-';
    cell.numFmt = '@';
    cell.font = { name: 'Arial', size: 10 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thin;
}

export async function exportEmployeesToExcel(employees, years) {
    const realLibyaYear = Number(getLibyaYear());
    const yearList = (years && years.length ? years : [String(realLibyaYear)]).map(String);
    const firstYear = yearList[0];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'منظومة إجازات الموظفين الرقمية';
    workbook.created = new Date();

    // ---------------------------------------------------------------
    // Sheet 1 — the register itself
    // ---------------------------------------------------------------
    const ws = workbook.addWorksheet('أرصدة الإجازات', {
        views: [{ rightToLeft: true, showGridLines: false, state: 'frozen', xSplit: 7, ySplit: 4 }],
    });

    const FIXED = 7;                       // A..G before the year bands
    const yearCols = yearList.length * 2;  // مضاف + مخصوم per year
    const firstYearCol = FIXED + 1;
    // With a single financial year in the system there are no "previous
    // years" to total: that column would repeat "رصيد ما قبل" verbatim in
    // every row, which reads as a mistake rather than as a subtotal. It
    // earns its place only once a second year exists.
    const multiYear = yearList.length > 1;
    const colPrev = multiYear ? FIXED + yearCols + 1 : 0;
    const colNet = (multiYear ? colPrev : FIXED + yearCols) + 1;
    const colEnt = colNet + 1;
    const colNote = colEnt + 1;
    const lastCol = colNote;

    ws.getColumn(1).width = 6;
    ws.getColumn(2).width = 32;
    ws.getColumn(3).width = 13;
    ws.getColumn(4).width = 15;
    ws.getColumn(5).width = 14;
    ws.getColumn(6).width = 15;
    ws.getColumn(7).width = 15;
    for (let c = firstYearCol; c <= FIXED + yearCols; c++) ws.getColumn(c).width = 12;
    if (multiYear) ws.getColumn(colPrev).width = 18;
    ws.getColumn(colNet).width = 16;
    ws.getColumn(colEnt).width = 14;
    ws.getColumn(colNote).width = 42;

    // Row 1 — title, and the year the register is drawn for.
    titleCell(ws.getCell(1, 1), 'كشف أرصدة الإجازات');
    ws.getCell(1, 5).value = `سنة الاستحقاق: ${realLibyaYear}`;
    ws.getCell(1, 5).font = { name: 'Arial', bold: true, size: 11, color: { argb: NAVY_LIGHT } };
    ws.getCell(1, colNet).value = `تاريخ التصدير: ${getLibyaDateStr()}`;
    ws.getCell(1, colNet).font = { name: 'Arial', size: 10, color: { argb: 'FF6B7A8C' } };
    ws.getRow(1).height = 20;

    // Rows 2-3 — the financial year banded above its own مضاف/مخصوم pair,
    // so a reader scanning sideways never loses which year a column is in.
    yearList.forEach((year, i) => {
        const c = firstYearCol + i * 2;
        const current = Number(year) === realLibyaYear;
        [c, c + 1].forEach((cc) => {
            const y2 = ws.getCell(2, cc);
            y2.value = Number(year);
            y2.numFmt = '0';
            headerCell(y2, current ? NAVY_LIGHT : NAVY);
        });
        headerCell(Object.assign(ws.getCell(3, c), { value: 'مضاف' }), current ? NAVY_LIGHT : NAVY);
        headerCell(Object.assign(ws.getCell(3, c + 1), { value: 'مخصوم' }), current ? NAVY_LIGHT : NAVY);
    });
    ws.getRow(2).height = 16;
    ws.getRow(3).height = 16;

    // Row 4 — the full labels, and the only row the filter attaches to.
    const labels = [];
    labels[1] = '#';
    labels[2] = 'الاسم';
    labels[3] = 'الرقم الوظيفي';
    labels[4] = 'الرقم الوطني';
    labels[5] = 'الصفة';
    labels[6] = 'تاريخ المباشرة';
    labels[7] = `رصيد ما قبل ${firstYear}`;
    yearList.forEach((year, i) => {
        labels[firstYearCol + i * 2] = `مضاف ${year}`;
        labels[firstYearCol + i * 2 + 1] = `مخصوم ${year}`;
    });
    if (multiYear) labels[colPrev] = 'الصافي التراكمي للسنوات السابقة';
    labels[colNet] = `الصافي التراكمي ${yearList[yearList.length - 1]}`;
    labels[colEnt] = 'الاستحقاق السنوي (يوم)';
    labels[colNote] = 'ملاحظات';
    for (let c = 1; c <= lastCol; c++) {
        const cell = ws.getCell(4, c);
        cell.value = labels[c] || '';
        headerCell(cell, c >= firstYearCol && c <= FIXED + yearCols ? NAVY_LIGHT : NAVY);
    }
    ws.getRow(4).height = 40;

    // Frozen employees sink to the bottom, matching EmployeesTable so the
    // exported order is the order the admin just looked at.
    const sorted = [...employees].sort((a, b) => (a.is_frozen ? 1 : 0) - (b.is_frozen ? 1 : 0));

    let r = 5;
    sorted.forEach((emp, idx) => {
        const ledger = computeYearlyLedger(emp, yearList, realLibyaYear);
        const row = ws.getRow(r);
        row.height = 20;

        const seq = row.getCell(1);
        seq.value = idx + 1;
        seq.numFmt = '0';
        seq.font = { name: 'Arial', size: 10 };
        seq.alignment = { horizontal: 'center', vertical: 'middle' };
        seq.border = thin;

        const nameCell = row.getCell(2);
        nameCell.value = emp.name || '';
        nameCell.font = { name: 'Arial', size: 10 };
        nameCell.alignment = { horizontal: 'right', vertical: 'middle' };
        nameCell.border = thin;

        idCell(row.getCell(3), emp.job_number);
        idCell(row.getCell(4), emp.national_id);

        const title = row.getCell(5);
        title.value = emp.job_title || '-';
        title.font = { name: 'Arial', size: 10 };
        title.alignment = { horizontal: 'center', vertical: 'middle' };
        title.border = thin;

        const hire = row.getCell(6);
        hire.value = emp.hire_date_current_year || emp.hire_date || '-';
        hire.numFmt = '@';
        hire.font = { name: 'Arial', size: 10 };
        hire.alignment = { horizontal: 'center', vertical: 'middle' };
        hire.border = thin;

        // "رصيد ما قبل" is the opening the ledger itself hands the first
        // exported year — which already carries the ceiled carry-over when
        // one applies, so the row adds up exactly as the screen does.
        const opening = ledger.length ? ledger[0].opening : 0;
        const openCell = row.getCell(7);
        openCell.value = opening;
        openCell.numFmt = NUM_FMT;
        openCell.fill = fill(AMBER);
        openCell.font = { name: 'Arial', size: 10, color: { argb: 'FF0000FF' } };
        openCell.alignment = { horizontal: 'center', vertical: 'middle' };
        openCell.border = thin;

        ledger.forEach((entry, i) => {
            const c = firstYearCol + i * 2;
            const current = Number(entry.year) === realLibyaYear;
            [[c, entry.added], [c + 1, entry.deducted]].forEach(([cc, v]) => {
                const cell = row.getCell(cc);
                cell.value = v;
                cell.numFmt = NUM_FMT;
                cell.fill = fill(current ? BLUE_TINT : GREY);
                cell.font = { name: 'Arial', size: 10, bold: current };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.border = thin;
            });
        });

        // Everything before the current year, then the running total. Both
        // taken from the ledger rather than re-summed, so the ceiled
        // carry-over is represented once and only once.
        const priorRows = ledger.filter((e) => Number(e.year) < realLibyaYear);
        const prior = priorRows.length ? priorRows[priorRows.length - 1].closing : opening;
        // The ledger's own final closing, not the net-balance helper. The
        // two differ whenever an employee carries an ARCHIVED year: it is
        // still in years_data so the balance counts it, but it is absent
        // from `years` and so has no column here. Taking the balance would
        // print a total the visible columns do not add up to. This column
        // is a snapshot of the on-screen table, and the table is drawn
        // from this very ledger.
        const net = ledger.length ? ledger[ledger.length - 1].closing : opening;

        const netCols = multiYear ? [[colPrev, prior, false], [colNet, net, true]]
                                  : [[colNet, net, true]];
        netCols.forEach(([cc, v, strong]) => {
            const cell = row.getCell(cc);
            cell.value = v;
            cell.numFmt = NUM_FMT;
            cell.fill = fill(strong ? BLUE_TINT : GREY);
            cell.font = { name: 'Arial', size: 10, bold: strong, color: strong ? { argb: NAVY } : undefined };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = thin;
        });

        const ent = row.getCell(colEnt);
        ent.value = emp.over_45 ? 45 : 30;
        ent.numFmt = '0';
        ent.font = { name: 'Arial', size: 10 };
        ent.alignment = { horizontal: 'center', vertical: 'middle' };
        ent.border = thin;

        const note = row.getCell(colNote);
        const flags = [];
        if (emp.over_45) flags.push('يستحق 45 يوماً');
        if (emp.is_unpaid_leave) flags.push('إجازة بدون مرتب — رصيد السنة الجارية مجمّد');
        if (emp.is_frozen) flags.push('سجل مجمّد');
        note.value = flags.join(' · ');
        note.font = { name: 'Arial', size: 9, color: { argb: 'FF6B7A8C' } };
        note.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
        note.border = thin;

        r++;
    });

    const lastRow = r - 1;
    if (lastRow >= 5) {
        ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: lastCol } };

        // Anyone at or below zero is the reason someone opens this file.
        ws.addConditionalFormatting({
            ref: `${ws.getColumn(colNet).letter}5:${ws.getColumn(colNet).letter}${lastRow}`,
            rules: [{
                type: 'cellIs', operator: 'lessThanOrEqual', formulae: ['0'], priority: 1,
                style: { font: { color: { argb: 'FF9B1C1C' }, bold: true },
                         fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFDE8E8' } } },
            }],
        });

        const totals = ws.getRow(lastRow + 1);
        totals.height = 24;
        const col = (c) => ws.getColumn(c).letter;
        totals.getCell(1).value = 'الإجمالي';
        for (let c = 1; c <= lastCol; c++) {
            const cell = totals.getCell(c);
            cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
            cell.fill = fill(NAVY);
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = thin;
            const summable = c === 7 || (c >= firstYearCol && c <= FIXED + yearCols)
                             || (multiYear && c === colPrev) || c === colNet;
            if (summable) {
                cell.value = { formula: `SUM(${col(c)}5:${col(c)}${lastRow})` };
                cell.numFmt = NUM_FMT;
            }
        }
    }

    ws.pageSetup = {
        paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { top: 0.5, right: 0.3, bottom: 0.8, left: 0.3, header: 0.2, footer: 0.5 },
    };
    ws.headerFooter.oddFooter =
        '&"Arial,Bold"&10&Rمراجعة وحدة شؤون الموظفين &Cاعتماد رئيس قسم الشؤون الإدارية &Lاعتماد مدير مكتب أوقاف القره بوللي';

    // ---------------------------------------------------------------
    // Sheet 2 — the rule this file was drawn under
    // ---------------------------------------------------------------
    const st = workbook.addWorksheet('الإعدادات', { views: [{ rightToLeft: true, showGridLines: false }] });
    st.getColumn(1).width = 3;
    st.getColumn(2).width = 46;
    st.getColumn(3).width = 18;
    st.getColumn(4).width = 78;

    titleCell(st.getCell(2, 2), 'لوحة الإعدادات — القواعد المطبَّقة', 13);
    st.getCell(3, 2).value = 'هذه القيم للاطلاع فقط: المنظومة هي مصدر الأرقام، وتغييرها هنا لا يغيّر شيئاً فيها.';
    st.getCell(3, 2).font = { name: 'Arial', size: 10, color: { argb: 'FF9B1C1C' } };

    ['البيان', 'القيمة', 'الشرح'].forEach((h, i) => headerCell(Object.assign(st.getCell(5, i + 2), { value: h })));

    const unpaid = employees.filter((e) => e.is_unpaid_leave).length;
    const settings = [
        ['سنة الاستحقاق الحالية', realLibyaYear, 'السنة الميلادية بتوقيت طرابلس وقت التصدير'],
        ['الرصيد السنوي الأساسي (يوم)', 30, 'لكل موظف ما لم تُفعَّل له صفة الاستحقاق الأعلى'],
        ['الرصيد السنوي للمستحقين (يوم)', 45, 'للموظفين المفعَّل لهم خيار «+45» في بيانات الموظف'],
        ['آلية الاستحقاق', 'على دفعتين', 'يُكتسب بالخدمة ويُضاف بعد انقضاء الأشهر، لا قبلها'],
        ['الدفعة الأولى', '1 يوليو', 'نصف الاستحقاق، بعد انقضاء الأشهر الستة الأولى'],
        ['الدفعة الثانية', '31 ديسمبر', 'النصف الثاني، بعد انقضاء السنة'],
        ['المعيَّن خلال السنة', 'بالتناسب', 'يُحسب له ما خدمه فعلاً من أشهر في كل نصف'],
        ['السنوات المعروضة في الكشف', yearList.join('، '), 'السنوات المالية النشطة في المنظومة'],
        ['عدد الموظفين', employees.length, 'غير شامل الموظفين المؤرشفين'],
        ['منهم بإجازة بدون مرتب', unpaid, 'رصيد السنة الجارية مجمّد عند صفر لهؤلاء'],
    ];
    settings.forEach(([b, c, d], i) => {
        const row = st.getRow(6 + i);
        row.getCell(2).value = b;
        row.getCell(3).value = c;
        row.getCell(4).value = d;
        row.getCell(2).font = { name: 'Arial', size: 10, bold: true };
        row.getCell(3).font = { name: 'Arial', size: 10, color: { argb: NAVY } };
        row.getCell(4).font = { name: 'Arial', size: 9, color: { argb: 'FF6B7A8C' } };
        row.getCell(3).fill = fill(BLUE_TINT);
        [2, 3, 4].forEach((c2) => {
            row.getCell(c2).border = thin;
            row.getCell(c2).alignment = { horizontal: c2 === 3 ? 'center' : 'right', vertical: 'middle', wrapText: c2 === 4 };
        });
    });

    // ---------------------------------------------------------------
    // Sheet 3 — the dashboard
    // ---------------------------------------------------------------
    const db = workbook.addWorksheet('لوحة المؤشرات', { views: [{ rightToLeft: true, showGridLines: false }] });
    db.getColumn(1).width = 3;
    db.getColumn(2).width = 34;
    db.getColumn(3).width = 18;
    db.getColumn(4).width = 6;
    db.getColumn(5).width = 22;
    db.getColumn(6).width = 14;
    db.getColumn(7).width = 16;

    titleCell(db.getCell(2, 2), 'لوحة مؤشرات أرصدة الإجازات', 13);
    db.getCell(3, 2).value = `سنة الاستحقاق: ${realLibyaYear} — تاريخ التصدير: ${getLibyaDateStr()}`;
    db.getCell(3, 2).font = { name: 'Arial', size: 10, color: { argb: 'FF6B7A8C' } };

    headerCell(Object.assign(db.getCell(5, 2), { value: 'المؤشرات العامة' }));
    headerCell(Object.assign(db.getCell(5, 3), { value: 'القيمة' }));

    const S = "'أرصدة الإجازات'";
    const cl = (c) => ws.getColumn(c).letter;
    const rng = (c) => `${S}!$${cl(c)}$5:$${cl(c)}$${Math.max(lastRow, 5)}`;
    const curAdded = firstYearCol + Math.max(0, yearList.indexOf(String(realLibyaYear))) * 2;

    const kpis = [
        ['عدد الموظفين', `COUNTA(${rng(2)})`],
        ...(multiYear ? [['إجمالي الصافي التراكمي للسنوات السابقة', `SUM(${rng(colPrev)})`]] : []),
        [`إجمالي رصيد ما قبل ${firstYear}`, `SUM(${rng(7)})`],
        [`إجمالي المضاف ${realLibyaYear}`, `SUM(${rng(curAdded)})`],
        [`إجمالي المخصوم ${realLibyaYear}`, `SUM(${rng(curAdded + 1)})`],
        ['إجمالي الصافي التراكمي', `SUM(${rng(colNet)})`],
        ['متوسط الرصيد لكل موظف', `IFERROR(AVERAGE(${rng(colNet)}),0)`],
        ['أعلى رصيد', `MAX(${rng(colNet)})`],
        ['صاحب أعلى رصيد', `IFERROR(INDEX(${rng(2)},MATCH(MAX(${rng(colNet)}),${rng(colNet)},0)),"-")`],
        ['عدد من رصيدهم أكثر من 100 يوم', `COUNTIF(${rng(colNet)},">100")`],
        ['عدد من رصيدهم صفر أو أقل', `COUNTIF(${rng(colNet)},"<=0")`],
        ['عدد مستحقي الرصيد الأعلى (45 يوم)', `COUNTIF(${rng(colEnt)},45)`],
    ];
    kpis.forEach(([label, formula], i) => {
        const row = db.getRow(6 + i);
        row.getCell(2).value = label;
        row.getCell(2).font = { name: 'Arial', size: 10, bold: true };
        row.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
        row.getCell(2).border = thin;
        const v = row.getCell(3);
        v.value = { formula };
        v.numFmt = label.startsWith('عدد') || label.startsWith('صاحب') ? '0' : NUM_FMT;
        if (label.startsWith('صاحب')) v.numFmt = '@';
        v.font = { name: 'Arial', size: 10, bold: true, color: { argb: NAVY } };
        v.fill = fill(BLUE_TINT);
        v.alignment = { horizontal: 'center', vertical: 'middle' };
        v.border = thin;
    });

    // The per-title breakdown is built from the titles actually present in
    // this export, not a fixed list. The previous version hard-coded the
    // categories, so any title outside it — متابع among them — was simply
    // absent from the file however many employees held it.
    headerCell(Object.assign(db.getCell(5, 5), { value: 'الصفة الوظيفية' }));
    headerCell(Object.assign(db.getCell(5, 6), { value: 'العدد' }));
    headerCell(Object.assign(db.getCell(5, 7), { value: 'إجمالي الرصيد' }));

    const titles = [...new Set(employees.map((e) => (e.job_title || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ar'));
    titles.forEach((t, i) => {
        const row = db.getRow(6 + i);
        row.getCell(5).value = t;
        row.getCell(5).font = { name: 'Arial', size: 10 };
        row.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };
        row.getCell(5).border = thin;
        const q = t.replace(/"/g, '""');
        [[6, `COUNTIF(${rng(5)},"${q}")`, '0'], [7, `SUMIF(${rng(5)},"${q}",${rng(colNet)})`, NUM_FMT]]
            .forEach(([c, formula, fmt]) => {
                const cell = row.getCell(c);
                cell.value = { formula };
                cell.numFmt = fmt;
                cell.font = { name: 'Arial', size: 10 };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.border = thin;
            });
    });
    if (titles.length) {
        const tr = db.getRow(6 + titles.length);
        tr.getCell(5).value = 'الإجمالي';
        [[6, '0'], [7, NUM_FMT]].forEach(([c, fmt]) => {
            const cell = tr.getCell(c);
            cell.value = { formula: `SUM(${db.getColumn(c).letter}6:${db.getColumn(c).letter}${5 + titles.length})` };
            cell.numFmt = fmt;
        });
        [5, 6, 7].forEach((c) => {
            const cell = tr.getCell(c);
            cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
            cell.fill = fill(NAVY);
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = thin;
        });
    }

    // ---------------------------------------------------------------
    // Sheet 4 — how to read the file
    // ---------------------------------------------------------------
    const gd = workbook.addWorksheet('دليل الاستخدام', { views: [{ rightToLeft: true, showGridLines: false }] });
    gd.getColumn(1).width = 3;
    gd.getColumn(2).width = 30;
    gd.getColumn(3).width = 104;
    titleCell(gd.getCell(2, 2), 'دليل الاستخدام', 13);

    const guide = [
        ['المعادلة المعتمدة', 'الصافي التراكمي = رصيد ما قبل السنة الأولى + مجموع المضاف − مجموع المخصوم.'],
        ['', 'وهو نفس الرقم الذي يعرضه عمود «الصافي التراكمي» في المنظومة، ونفس الرصيد الذي يفحصه النظام عند تسجيل أي خصم.'],
        ['الاستحقاق السنوي', '30 يوماً لكل موظف، و45 يوماً لمن فُعِّلت له صفة «+45» في بيانات الموظف داخل المنظومة.'],
        ['متى يُضاف', 'يُكتسب بالخدمة ويُضاف بعد انقضاء الأشهر: نصفه في 1 يوليو بعد انقضاء الستة الأولى، ونصفه في 31 ديسمبر بعد انقضاء السنة.'],
        ['', 'لذلك يظهر «مضاف» بنصف قيمته خلال النصف الثاني من السنة، ويكتمل في 31 ديسمبر. هذا ليس نقصاً في البيانات.'],
        ['المعيَّن خلال السنة', 'يُحسب له ما خدمه فعلاً من أشهر داخل كل نصف، فيقلّ استحقاقه في سنة تعيينه بالتناسب.'],
        ['إجازة بدون مرتب', 'رصيد السنة الجارية مجمّد عند صفر، مع بقاء الرصيد المرحّل من السنوات السابقة كما هو. مؤشَّر في عمود الملاحظات.'],
        ['الأرقام هنا قيم لا معادلات', 'كل رقم يخصّ موظفاً منقول كما هو من المنظومة، فلا يمكن لهذا الملف أن يخالفها. المعادلات مقصورة على صفوف الإجماليات ولوحة المؤشرات.'],
        ['تنبيه', 'تعديل أي رقم في هذا الملف لا يغيّر شيئاً في المنظومة. التعديل يكون من داخل البرنامج، ثم يُعاد التصدير.'],
        ['لوحة المؤشرات', 'الصفات الوظيفية فيها مبنية من صفات الموظفين الموجودين فعلاً في هذا التصدير، فلا تسقط منها أي صفة.'],
    ];
    guide.forEach(([b, c], i) => {
        const row = gd.getRow(4 + i);
        row.height = 30;
        row.getCell(2).value = b;
        row.getCell(2).font = { name: 'Arial', size: 10, bold: true, color: { argb: NAVY } };
        row.getCell(2).alignment = { horizontal: 'right', vertical: 'top' };
        row.getCell(3).value = c;
        row.getCell(3).font = { name: 'Arial', size: 10 };
        row.getCell(3).alignment = { horizontal: 'right', vertical: 'top', wrapText: true };
    });

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
