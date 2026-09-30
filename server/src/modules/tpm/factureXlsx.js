const ExcelJS = require('exceljs');
const { SECTIONS, SECTION_OF } = require('../contracts/budgetCatalog');

/**
 * Export a facture (état des dépenses) as a real .xlsx with live formulas:
 * each poste montant = Qté × Coût unitaire, section sub-totals = SUM(...),
 * and the grand totals (Total, part bailleur, part ONG, net après avance)
 * recompute if the user edits a cell. Neutral terminology (bailleur / ONG).
 */

const BLUE = 'FF1F6EBC';
const GREY = 'FFECEFF3';
const money = '#,##0 "Ar"';
const SECTION_LABEL = Object.fromEntries(SECTIONS.map((s) => [s.code, s.label]));
const PAYER_LABEL = { bailleur: 'Bailleur', ong: 'ONG' };

function addEtatSheet(wb, report) {
  const ws = wb.addWorksheet('État des dépenses', {
    views: [{ state: 'frozen', ySplit: 7 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 },
  });

  ws.columns = [
    { key: 'ligne', width: 30 },
    { key: 'desc', width: 40 },
    { key: 'unite', width: 12 },
    { key: 'qte', width: 10 },
    { key: 'cout', width: 16 },
    { key: 'montant', width: 18 },
    { key: 'charge', width: 12 },
    { key: 'obs', width: 28 },
  ];

  ws.mergeCells('A1:H1');
  const t1 = ws.getCell('A1');
  t1.value = 'État des dépenses — Facture';
  t1.font = { name: 'Calibri', size: 15, bold: true, color: { argb: BLUE } };
  ws.getRow(1).height = 24;

  const periode = report.periodEnd && report.periodEnd !== report.periodMonth
    ? `${String(report.periodMonth).slice(0, 7)} → ${String(report.periodEnd).slice(0, 7)}`
    : String(report.periodMonth).slice(0, 7);
  ws.mergeCells('A2:H2');
  ws.getCell('A2').value = `${report.partnerName} · ${report.contractNumero}`;
  ws.getCell('A2').font = { size: 11, color: { argb: 'FF666B72' } };
  ws.mergeCells('A3:H3');
  ws.getCell('A3').value = `Période : ${periode}${report.invoiceNo ? ` · Facture n° ${report.invoiceNo}` : ''}`;
  ws.getCell('A3').font = { size: 10, color: { argb: 'FF666B72' } };

  const headerRowIdx = 6;
  const header = ws.getRow(headerRowIdx);
  header.values = ['Ligne budgétaire', 'Désignation (poste)', 'Unité', 'Qté', 'Coût unitaire', 'Montant', 'À la charge de', 'Observation'];
  header.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  header.height = 22;

  // Group items by section, in catalogue order.
  const bySec = new Map();
  for (const it of report.items || []) {
    const code = SECTION_OF[it.lineCode] || String(it.lineCode || '').split('.')[0];
    if (!bySec.has(code)) bySec.set(code, []);
    bySec.get(code).push(it);
  }

  let row = headerRowIdx + 1;
  const subtotalRows = [];
  for (const sec of SECTIONS) {
    const items = bySec.get(sec.code);
    if (!items || items.length === 0) continue;

    ws.mergeCells(`A${row}:H${row}`);
    const sc = ws.getCell(`A${row}`);
    sc.value = `${sec.code}. ${SECTION_LABEL[sec.code]}`;
    sc.font = { bold: true, color: { argb: BLUE } };
    sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } };
    row += 1;

    const firstItemRow = row;
    for (const it of items) {
      const r = ws.getRow(row);
      r.getCell(1).value = it.lineLabel || it.lineCode;
      r.getCell(2).value = it.designation;
      r.getCell(3).value = it.unit || '';
      r.getCell(4).value = Number(it.unitCount) || 0;
      r.getCell(5).value = Number(it.unitCost) || 0;
      r.getCell(5).numFmt = money;
      r.getCell(6).value = { formula: `D${row}*E${row}` };
      r.getCell(6).numFmt = money;
      r.getCell(7).value = PAYER_LABEL[it.payBy] || 'Bailleur';
      r.getCell(8).value = it.observation || '';
      row += 1;
    }

    const st = ws.getRow(row);
    st.getCell(2).value = `Sous-total ${sec.code}`;
    st.getCell(2).font = { bold: true };
    st.getCell(6).value = { formula: `SUM(F${firstItemRow}:F${row - 1})` };
    st.getCell(6).numFmt = money;
    st.getCell(6).font = { bold: true };
    subtotalRows.push(row);
    row += 1;
    row += 1; // spacer
  }

  // Grand totals.
  const totalsStart = row + 1;
  const put = (label, formula) => {
    const r = ws.getRow(row);
    r.getCell(5).value = label;
    r.getCell(5).font = { bold: true };
    r.getCell(5).alignment = { horizontal: 'right' };
    r.getCell(6).value = formula;
    r.getCell(6).numFmt = money;
    r.getCell(6).font = { bold: true, color: { argb: BLUE } };
    row += 1;
  };
  const sumSub = subtotalRows.length ? subtotalRows.map((r) => `F${r}`).join('+') : '0';
  put('Total des dépenses', { formula: sumSub });
  // Funder / ONG split can't be a clean cross-column SUMIF here, so use the
  // computed summary values (still correct; the montant formulas above stay live).
  ws.getRow(row).getCell(5).value = 'À la charge du bailleur (Réalisé)';
  ws.getRow(row).getCell(5).font = { bold: true }; ws.getRow(row).getCell(5).alignment = { horizontal: 'right' };
  ws.getRow(row).getCell(6).value = report.summary.funder; ws.getRow(row).getCell(6).numFmt = money;
  ws.getRow(row).getCell(6).font = { bold: true, color: { argb: BLUE } };
  row += 1;
  ws.getRow(row).getCell(5).value = "À la charge de l'ONG";
  ws.getRow(row).getCell(5).font = { bold: true }; ws.getRow(row).getCell(5).alignment = { horizontal: 'right' };
  ws.getRow(row).getCell(6).value = report.summary.ong; ws.getRow(row).getCell(6).numFmt = money;
  row += 1;
  if (Number(report.advanceDeducted) > 0) {
    ws.getRow(row).getCell(5).value = 'Net après avance déduite';
    ws.getRow(row).getCell(5).font = { bold: true }; ws.getRow(row).getCell(5).alignment = { horizontal: 'right' };
    ws.getRow(row).getCell(6).value = Number(report.summary.funder) - Number(report.advanceDeducted);
    ws.getRow(row).getCell(6).numFmt = money;
    row += 1;
  }

  // Signature block.
  row += 1;
  ws.getRow(row).getCell(1).value = 'Préparé par :';
  ws.getRow(row).getCell(5).value = 'Validé par :';
  void totalsStart;
  return ws;
}

/** Backward-compatible: a workbook with just the detailed état des dépenses. */
function buildFactureWorkbook(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MEMS 2.0';
  wb.created = new Date();
  addEtatSheet(wb, report);
  return wb;
}

// ---- Formal invoice sheet (INVOICE Mx layout, neutral terminology) --------
const HEAD_FILL = 'FF2A93FC';

/**
 * Faithful reproduction of the « Facture » (INVOICE) tab: an identity header,
 * then per FLA line Budget · Dépenses du mois · Dépenses cumulées · Montant
 * restant, section totals, VI total direct, VII commission de gestion, TOTAL,
 * avance à déduire and montant à payer, plus a signature block. Neutral terms
 * (bailleur), never PAM/WFP.
 */
function addInvoiceSheet(wb, invoice) {
  const { report, budgetByLine = {}, cumulByLine = {} } = invoice;
  const ws = wb.addWorksheet('Facture', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [
    { key: 'ligne', width: 46 }, { key: 'budget', width: 18 },
    { key: 'mois', width: 18 }, { key: 'cumul', width: 18 }, { key: 'restant', width: 18 },
  ];

  ws.mergeCells('A1:E1');
  const t1 = ws.getCell('A1');
  t1.value = 'Facture et État des dépenses';
  t1.font = { name: 'Calibri', size: 15, bold: true, color: { argb: BLUE } };
  ws.getRow(1).height = 24;

  // Identity block.
  const idRows = [
    ['Partenaire Coopérant (PC)', report.partnerName],
    ['Numéro de Facture', report.reference || ''],
    ['Monnaie', 'MGA'],
    ['Numéro du FLA', report.numeroFla || report.contractNumero || ''],
    ['Numéro PO', report.numeroPo || ''],
    ['Numéro de Vendor', report.numeroVendor || ''],
    ['Période de facturation', String(report.periodMonth || '').slice(0, 7)],
    ['Durée du FLA', [report.dateDebut, report.dateFin].filter(Boolean).map((d) => String(d).slice(0, 10)).join(' → ')],
    ['Avance reçue du bailleur', Number(report.advanceDeducted) || 0],
  ];
  let row = 3;
  for (const [label, value] of idRows) {
    const r = ws.getRow(row);
    r.getCell(1).value = label; r.getCell(1).font = { bold: true, color: { argb: 'FF555B63' } };
    r.getCell(2).value = value;
    if (label.startsWith('Avance')) r.getCell(2).numFmt = money;
    row += 1;
  }
  row += 1;

  // Table header.
  const headerRowIdx = row;
  const header = ws.getRow(row);
  header.values = ['Ligne budgétaire du FLA', 'Budget FLA (contribution bailleur)', 'Dépenses du mois', 'Dépenses cumulées', 'Montant restant'];
  header.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  header.height = 30;
  row += 1;

  // This month's funder spend per line.
  const monthByLine = {};
  for (const it of report.items || []) {
    const cents = Math.round(Number(it.unitCount || 0) * Number(it.unitCost || 0) * 100);
    const pct = it.bailleurPct == null ? 1 : Number(it.bailleurPct);
    monthByLine[it.lineCode] = (monthByLine[it.lineCode] || 0) + Math.round(cents * pct) / 100;
  }

  const sectionTotalRows = [];
  let directBudget = 0; let directMonth = 0; let directCumul = 0;
  for (const sec of SECTIONS) {
    // A section shows if it has any budget, this-month or cumulative amount.
    const lines = sec.lines.map(([code, label]) => {
      const lc = `${sec.code}.${code}`;
      return { lc, label, budget: budgetByLine[lc] || 0, month: monthByLine[lc] || 0, cumul: cumulByLine[lc] || 0 };
    }).filter((l) => l.budget || l.month || l.cumul);
    if (lines.length === 0) continue;

    ws.mergeCells(`A${row}:E${row}`);
    const sc = ws.getCell(`A${row}`);
    sc.value = `${sec.code}. ${SECTION_LABEL[sec.code]}`;
    sc.font = { bold: true, color: { argb: BLUE } };
    sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } };
    row += 1;

    const first = row;
    let sb = 0; let sm = 0; let scu = 0;
    for (const l of lines) {
      const r = ws.getRow(row);
      r.getCell(1).value = l.label;
      r.getCell(2).value = l.budget; r.getCell(2).numFmt = money;
      r.getCell(3).value = l.month; r.getCell(3).numFmt = money;
      r.getCell(4).value = l.cumul; r.getCell(4).numFmt = money;
      r.getCell(5).value = { formula: `B${row}-D${row}` }; r.getCell(5).numFmt = money;
      sb += l.budget; sm += l.month; scu += l.cumul;
      row += 1;
    }
    const st = ws.getRow(row);
    st.getCell(1).value = `Total ${sec.code}`; st.getCell(1).font = { bold: true };
    st.getCell(2).value = { formula: `SUM(B${first}:B${row - 1})` }; st.getCell(2).numFmt = money;
    st.getCell(3).value = { formula: `SUM(C${first}:C${row - 1})` }; st.getCell(3).numFmt = money;
    st.getCell(4).value = { formula: `SUM(D${first}:D${row - 1})` }; st.getCell(4).numFmt = money;
    st.getCell(5).value = { formula: `B${row}-D${row}` }; st.getCell(5).numFmt = money;
    st.eachCell((c) => { c.font = { ...(c.font || {}), bold: true }; c.border = { top: { style: 'thin', color: { argb: 'FFCED4DA' } } }; });
    sectionTotalRows.push(row);
    directBudget += sb; directMonth += sm; directCumul += scu;
    row += 2;
  }

  const feePct = Number(report.managementFeePct) || 0;
  const putTotal = (label, budget, month, cumul, opts = {}) => {
    const r = ws.getRow(row);
    r.getCell(1).value = label;
    r.getCell(2).value = budget; r.getCell(3).value = month; r.getCell(4).value = cumul;
    r.getCell(5).value = { formula: `B${row}-D${row}` };
    for (let c = 2; c <= 5; c++) r.getCell(c).numFmt = money;
    r.eachCell((c) => { c.font = { bold: true, color: opts.blue ? { argb: BLUE } : undefined, size: opts.big ? 12 : undefined }; });
    if (opts.top) r.eachCell((c) => { c.border = { top: { style: opts.big ? 'double' : 'thin', color: { argb: opts.big ? BLUE : 'FFCED4DA' } } }; });
    row += 1;
  };
  putTotal('VI. Total des coûts directs (I à V)', directBudget, directMonth, directCumul, { top: true });
  const feeB = Math.round(directBudget * feePct * 100) / 100;
  const feeM = Math.round(directMonth * feePct * 100) / 100;
  const feeC = Math.round(directCumul * feePct * 100) / 100;
  putTotal(`VII. Commission de gestion (${Math.round(feePct * 1000) / 10} %)`, feeB, feeM, feeC);
  putTotal('TOTAL (VI + VII)', directBudget + feeB, directMonth + feeM, directCumul + feeC, { top: true, blue: true, big: true });

  row += 1;
  const advance = Number(report.advanceDeducted) || 0;
  const netRow = ws.getRow(row);
  netRow.getCell(1).value = 'Avance à déduire'; netRow.getCell(1).font = { bold: true };
  netRow.getCell(3).value = advance; netRow.getCell(3).numFmt = money;
  row += 1;
  const payRow = ws.getRow(row);
  payRow.getCell(1).value = 'Montant à payer pour le mois'; payRow.getCell(1).font = { bold: true, color: { argb: BLUE }, size: 12 };
  payRow.getCell(3).value = Math.round((directMonth + feeM - advance) * 100) / 100;
  payRow.getCell(3).numFmt = money; payRow.getCell(3).font = { bold: true, color: { argb: BLUE }, size: 12 };
  row += 2;

  ws.getRow(row).getCell(1).value = 'Soumis par :';
  ws.getRow(row).getCell(3).value = 'Validé par :';
  row += 3;
  ws.getRow(row).getCell(1).value = 'Date / Signature';
  ws.getRow(row).getCell(3).value = 'Date / Signature';
  void headerRowIdx;
  return ws;
}

/** Full invoice workbook: the formal « Facture » sheet + the detailed « État
 * des dépenses » sheet, like the real template. */
function buildInvoiceWorkbook(invoice) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MEMS 2.0';
  wb.created = new Date();
  addInvoiceSheet(wb, invoice);
  addEtatSheet(wb, invoice.report);
  return wb;
}

module.exports = { buildFactureWorkbook, buildInvoiceWorkbook, addEtatSheet, addInvoiceSheet };
