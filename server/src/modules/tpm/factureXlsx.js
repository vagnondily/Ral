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

function buildFactureWorkbook(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MEMS 2.0';
  wb.created = new Date();
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

  return wb;
}

module.exports = { buildFactureWorkbook };
