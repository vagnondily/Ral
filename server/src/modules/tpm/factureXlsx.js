const ExcelJS = require('exceljs');
const { SECTIONS, SECTION_OF } = require('../contracts/budgetCatalog');
const { itemCents, funderCentsOf, bailleurPctOf } = require('./reportMath');

/**
 * Export a facture (état des dépenses) as a real .xlsx with live formulas,
 * faithful to the template's « à payer par le bailleur / par l'ONG » columns:
 * each poste montant = ROUND(Qté × Coût unitaire, 2), part bailleur =
 * ROUND(montant × % bailleur, 2), part ONG = montant − part bailleur; section
 * sub-totals and grand totals are SUMs. Every formula also carries its cached
 * result computed in integer cents by reportMath, so the figures read without
 * recalculation are exactly the app's. Neutral terminology (bailleur / ONG).
 */

const { moneyNumFmt } = require('../common/currencyFmt');
const BLUE = 'FF1F6EBC';
const GREY = 'FFECEFF3';
// Devise du pays (multi-pays, étape 1b) : chaque export fixe `money` depuis la devise reçue, au DÉBUT
// de la construction synchrone du classeur (aucune attente entre-temps). Défaut : ariary (« Ar »).
let money = '#,##0 "Ar"';
// Format du % bailleur : « 90 % », « 33,333 % ». Jamais '0.###%' qui affiche
// « 90.% » dans Excel (séparateur décimal orphelin sur une valeur entière).
const pctFmtOf = (pct) => (Number.isInteger(Math.round(pct * 1e5) / 1e3) ? '0%' : '0.0##%');
const SECTION_LABEL = Object.fromEntries(SECTIONS.map((s) => [s.code, s.label]));
const ar = (cents) => cents / 100;

/** Montant, part bailleur et part ONG d'un poste, en centimes entiers (reportMath). */
function lineSplit(it) {
  const cents = itemCents(it);
  const funder = funderCentsOf(it);
  return { cents, funder, ong: cents - funder, pct: bailleurPctOf(it) };
}

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
    { key: 'pct', width: 11 },
    { key: 'bailleur', width: 18 },
    { key: 'ong', width: 18 },
    { key: 'obs', width: 28 },
  ];

  ws.mergeCells('A1:J1');
  const t1 = ws.getCell('A1');
  t1.value = 'État des dépenses — Facture';
  t1.font = { name: 'Calibri', size: 15, bold: true, color: { argb: BLUE } };
  ws.getRow(1).height = 24;

  const periode = report.periodEnd && report.periodEnd !== report.periodMonth
    ? `${String(report.periodMonth).slice(0, 7)} → ${String(report.periodEnd).slice(0, 7)}`
    : String(report.periodMonth).slice(0, 7);
  ws.mergeCells('A2:J2');
  ws.getCell('A2').value = `${report.partnerName} · ${report.contractNumero}`;
  ws.getCell('A2').font = { size: 11, color: { argb: 'FF666B72' } };
  ws.mergeCells('A3:J3');
  ws.getCell('A3').value = `Période : ${periode}${report.invoiceNo ? ` · Facture n° ${report.invoiceNo}` : ''}`;
  ws.getCell('A3').font = { size: 10, color: { argb: 'FF666B72' } };

  const headerRowIdx = 6;
  const header = ws.getRow(headerRowIdx);
  header.values = ['Ligne budgétaire', 'Désignation (poste)', 'Unité', 'Qté', 'Coût unitaire', 'Montant',
    '% bailleur', 'À payer par le bailleur', "À payer par l'ONG", 'Observation'];
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
  const grand = { cents: 0, funder: 0, ong: 0 };
  for (const sec of SECTIONS) {
    const items = bySec.get(sec.code);
    if (!items || items.length === 0) continue;

    ws.mergeCells(`A${row}:J${row}`);
    const sc = ws.getCell(`A${row}`);
    sc.value = `${sec.code}. ${SECTION_LABEL[sec.code]}`;
    sc.font = { bold: true, color: { argb: BLUE } };
    sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } };
    row += 1;

    const firstItemRow = row;
    const sub = { cents: 0, funder: 0, ong: 0 };
    for (const it of items) {
      const split = lineSplit(it);
      const r = ws.getRow(row);
      r.getCell(1).value = it.lineLabel || it.lineCode;
      r.getCell(2).value = it.designation;
      r.getCell(3).value = it.unit || '';
      r.getCell(4).value = Number(it.unitCount) || 0;
      r.getCell(5).value = Number(it.unitCost) || 0;
      r.getCell(5).numFmt = money;
      r.getCell(6).value = { formula: `ROUND(D${row}*E${row},2)`, result: ar(split.cents) };
      r.getCell(7).value = split.pct;
      r.getCell(7).numFmt = pctFmtOf(split.pct);
      r.getCell(8).value = { formula: `ROUND(F${row}*G${row},2)`, result: ar(split.funder) };
      r.getCell(9).value = { formula: `F${row}-H${row}`, result: ar(split.ong) };
      for (const c of [6, 8, 9]) r.getCell(c).numFmt = money;
      r.getCell(10).value = it.observation || '';
      sub.cents += split.cents; sub.funder += split.funder; sub.ong += split.ong;
      row += 1;
    }

    const st = ws.getRow(row);
    st.getCell(2).value = `Sous-total ${sec.code}`;
    st.getCell(2).font = { bold: true };
    for (const [c, col, cents] of [[6, 'F', sub.cents], [8, 'H', sub.funder], [9, 'I', sub.ong]]) {
      st.getCell(c).value = { formula: `SUM(${col}${firstItemRow}:${col}${row - 1})`, result: ar(cents) };
      st.getCell(c).numFmt = money;
      st.getCell(c).font = { bold: true };
    }
    grand.cents += sub.cents; grand.funder += sub.funder; grand.ong += sub.ong;
    subtotalRows.push(row);
    row += 1;
    row += 1; // spacer
  }

  // Grand totals : sommes des sous-totaux (colonnes Montant, bailleur, ONG).
  const sumOf = (col) => (subtotalRows.length ? subtotalRows.map((r) => `${col}${r}`).join('+') : '0');
  const put = (label, col, formula, cents, opts = {}) => {
    const r = ws.getRow(row);
    r.getCell(5).value = label;
    r.getCell(5).font = { bold: true };
    r.getCell(5).alignment = { horizontal: 'right' };
    const c = r.getCell(col);
    c.value = { formula, result: ar(cents) };
    c.numFmt = money;
    c.font = { bold: true, color: opts.blue ? { argb: BLUE } : undefined };
    row += 1;
    return row - 1;
  };
  put('Total des dépenses', 6, sumOf('F'), grand.cents, { blue: true });
  const funderRow = put('À payer par le bailleur (Réalisé)', 8, sumOf('H'), grand.funder, { blue: true });
  put("À payer par l'ONG", 9, sumOf('I'), grand.ong);
  const advance = Math.round((Number(report.advanceDeducted) || 0) * 100);
  if (advance > 0) {
    put('Net après avance déduite', 8, `H${funderRow}-${ar(advance)}`, grand.funder - advance);
  }

  // Signature block.
  row += 1;
  ws.getRow(row).getCell(1).value = 'Préparé par :';
  ws.getRow(row).getCell(5).value = 'Validé par :';
  return ws;
}

/** New workbook whose formulas Excel recalculates on opening. */
function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MEMS 2.0';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}

/** Backward-compatible: a workbook with just the detailed état des dépenses. */
function buildFactureWorkbook(report, { currency } = {}) {
  money = currency === undefined ? '#,##0 "Ar"' : moneyNumFmt(currency);
  const wb = newWorkbook();
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
    ['Numéro de Facture', report.invoiceNo || ''], // jamais la « référence » (autre champ)
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

  // This month's funder spend per line: part bailleur de chaque poste
  // (montant × % bailleur), cumulée en centimes entiers (reportMath).
  const monthCents = {};
  for (const it of report.items || []) {
    monthCents[it.lineCode] = (monthCents[it.lineCode] || 0) + funderCentsOf(it);
  }
  const monthByLine = Object.fromEntries(Object.entries(monthCents).map(([lc, c]) => [lc, ar(c)]));

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
function buildInvoiceWorkbook(invoice, { currency } = {}) {
  money = currency === undefined ? '#,##0 "Ar"' : moneyNumFmt(currency);
  const wb = newWorkbook();
  addInvoiceSheet(wb, invoice);
  addEtatSheet(wb, invoice.report);
  return wb;
}

module.exports = { pctFmtOf, buildFactureWorkbook, buildInvoiceWorkbook, addEtatSheet, addInvoiceSheet };
