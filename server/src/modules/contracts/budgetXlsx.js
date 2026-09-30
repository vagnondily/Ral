const ExcelJS = require('exceljs');
const { SECTIONS, MONITORING_LINE } = require('./budgetCatalog');

// Reproduces the FLA "Budget de l'accord" template as a real .xlsx WITH live
// formulas: each poste montant = Nb unités × Coût unitaire, section sub-totals
// = SUM(...), direct total = SUM(sections), commission = direct × %, and
// Total de l'accord = direct + commission — so the user can edit a quantity
// or a unit cost and the whole sheet recomputes, exactly like the template.

const BLUE = 'FF1F6EBC';
const HEAD = 'FF2A93FC';
const GREY = 'FFECEFF3';
const money = '#,##0 "Ar"';

function buildBudgetWorkbook({ contract, activities, items, feePct, months }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MEMS 2.0';
  wb.created = new Date();
  const ws = wb.addWorksheet("Budget de l'accord", {
    views: [{ state: 'frozen', ySplit: 6 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true },
  });

  ws.columns = [
    { key: 'ligne', width: 34 },
    { key: 'desc', width: 42 },
    { key: 'qte', width: 12 },
    { key: 'cout', width: 16 },
    { key: 'montant', width: 18 },
    { key: 'activite', width: 22 },
  ];

  const actLabel = Object.fromEntries(activities.map((a) => [a.id, a.label]));
  const itemActivity = (it) => {
    const id = Object.keys(it.allocations || {})[0];
    return (id && actLabel[id]) || (activities[0] && activities[0].label) || '';
  };

  // ---- Title block
  ws.mergeCells('A1:F1');
  const t1 = ws.getCell('A1');
  t1.value = "Budget de l'accord — Field Level Agreement";
  t1.font = { name: 'Calibri', size: 15, bold: true, color: { argb: BLUE } };
  t1.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 24;

  ws.mergeCells('A2:F2');
  ws.getCell('A2').value = `${contract.partnerName} · ${contract.reference || contract.numeroFla || contract.numero}`;
  ws.getCell('A2').font = { size: 11, color: { argb: 'FF666B72' } };

  ws.mergeCells('A3:F3');
  ws.getCell('A3').value = `Période : ${contract.dateDebut} → ${contract.dateFin} (${months} mois)`;
  ws.getCell('A3').font = { size: 10, color: { argb: 'FF666B72' } };

  // ---- Header row (row 6)
  const headerRowIdx = 6;
  const header = ws.getRow(headerRowIdx);
  header.values = ['Ligne budgétaire du FLA', 'Désignation (poste)', 'Nb unités', 'Coût unitaire', 'Montant', 'Activité'];
  header.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: 'FFCED4DA' } } };
  });
  header.height = 26;

  const byLine = new Map();
  for (const it of items) {
    if (!byLine.has(it.lineCode)) byLine.set(it.lineCode, []);
    byLine.get(it.lineCode).push(it);
  }

  let r = headerRowIdx + 1;
  const sectionSubtotalRows = [];

  for (const sec of SECTIONS) {
    const secItems = sec.lines.flatMap(([line]) => byLine.get(`${sec.code}.${line}`) || []);
    if (secItems.length === 0) continue;

    // Section header
    ws.mergeCells(`A${r}:F${r}`);
    const sh = ws.getCell(`A${r}`);
    sh.value = `${sec.code} — ${sec.label}`;
    sh.font = { bold: true, color: { argb: BLUE } };
    sh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } };
    r += 1;

    const firstItemRow = r;
    for (const [line, label] of sec.lines) {
      const lineItems = byLine.get(`${sec.code}.${line}`) || [];
      for (const it of lineItems) {
        const row = ws.getRow(r);
        row.getCell(1).value = label + (`${sec.code}.${line}` === MONITORING_LINE ? ' [Suivi/TPM]' : '');
        row.getCell(2).value = it.description;
        row.getCell(3).value = Number(it.unitCount) || 0;
        row.getCell(4).value = Number(it.unitCost) || 0;
        row.getCell(5).value = { formula: `C${r}*D${r}` }; // montant = qté × coût
        row.getCell(6).value = itemActivity(it);
        row.getCell(3).numFmt = '#,##0';
        row.getCell(4).numFmt = money;
        row.getCell(5).numFmt = money;
        row.getCell(1).font = { color: { argb: 'FF404040' } };
        r += 1;
      }
    }
    const lastItemRow = r - 1;

    // Section sub-total
    const st = ws.getRow(r);
    st.getCell(2).value = `Sous-total ${sec.code}`;
    st.getCell(5).value = { formula: `SUM(E${firstItemRow}:E${lastItemRow})` };
    st.getCell(2).font = { bold: true };
    st.getCell(5).font = { bold: true };
    st.getCell(5).numFmt = money;
    st.eachCell((c) => { c.border = { top: { style: 'thin', color: { argb: 'FFCED4DA' } } }; });
    sectionSubtotalRows.push(r);
    r += 2;
  }

  // ---- Totals
  const directRow = r;
  const dr = ws.getRow(directRow);
  dr.getCell(2).value = 'Total des coûts directs (I–V)';
  dr.getCell(5).value = { formula: sectionSubtotalRows.map((n) => `E${n}`).join('+') || '0' };
  dr.getCell(2).font = { bold: true };
  dr.getCell(5).font = { bold: true };
  dr.getCell(5).numFmt = money;
  r += 1;

  // fee % in its own editable cell (D), commission amount = direct × %
  const feeRow = r;
  const fr = ws.getRow(feeRow);
  fr.getCell(2).value = 'Commission de gestion';
  fr.getCell(4).value = Number(feePct) || 0;
  fr.getCell(4).numFmt = '0.0%';
  fr.getCell(5).value = { formula: `E${directRow}*D${feeRow}` };
  fr.getCell(5).numFmt = money;
  r += 1;

  const grandRow = r;
  const gr = ws.getRow(grandRow);
  gr.getCell(2).value = "Total de l'accord (plafond du contrat)";
  gr.getCell(5).value = { formula: `E${directRow}+E${feeRow}` };
  gr.getCell(2).font = { bold: true, size: 12, color: { argb: BLUE } };
  gr.getCell(5).font = { bold: true, size: 12, color: { argb: BLUE } };
  gr.getCell(5).numFmt = money;
  gr.eachCell((c) => { c.border = { top: { style: 'double', color: { argb: BLUE } } }; });
  r += 1;

  const monthlyRow = r;
  const mr = ws.getRow(monthlyRow);
  mr.getCell(2).value = `Barème mensuel (total ÷ ${months} mois)`;
  mr.getCell(5).value = { formula: `E${grandRow}/${months || 1}` };
  mr.getCell(5).numFmt = money;
  mr.getCell(2).font = { italic: true };
  mr.getCell(5).font = { italic: true };

  return wb;
}

module.exports = { buildBudgetWorkbook };
