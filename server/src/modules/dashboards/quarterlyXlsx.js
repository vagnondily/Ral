const ExcelJS = require('exceljs');

/**
 * Export Excel du rapport trimestriel (retour 54), même disposition que l'écran et que le
 * classeur MMR de l'utilisateur : une ligne par activité + Total ; par trimestre (et pour
 * l'année) : sites uniques actifs, prévus, réalisés, Couverture, Taux d'exécution.
 * Les taux sont des valeurs (format %) colorées du rouge au vert ; « — » sans dénominateur.
 */
const FILL = { low: 'FFF4C7C3', mid: 'FFFCE8B2', fair: 'FFE2F0D9', high: 'FFB7E1CD' };
const METRICS = [
  ['active', 'Sites actifs (uniques)'], ['planned', 'Sites prévus'], ['realised', 'Sites réalisés'],
  ['coverage', 'Couverture (réalisés ÷ actifs)'], ['execution', 'Taux d\'exécution (réalisés ÷ prévus)'],
];

function buildQuarterlyWorkbook(table, { title, unnamed = 'Sans activité' } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MEMS 2.0';
  const ws = wb.addWorksheet(`Trimestriel ${table.year}`, { views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }] });
  ws.getCell(1, 1).value = title || `Rapport trimestriel par activité — ${table.year}`;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  const head = ['Activité'];
  const groups = [];
  for (const p of table.periods) {
    groups.push({ label: p.key === 'year' ? `Année ${table.year}` : `${p.key} ${table.year}`, start: head.length + 1 });
    for (const [, l] of METRICS) head.push(l);
  }
  for (const g of groups) {
    ws.mergeCells(2, g.start, 2, g.start + METRICS.length - 1);
    const c = ws.getCell(2, g.start); c.value = g.label; c.font = { bold: true }; c.alignment = { horizontal: 'center' };
  }
  head.forEach((h, i) => { const c = ws.getCell(3, i + 1); c.value = h; c.font = { bold: true }; c.alignment = { wrapText: true, vertical: 'top' }; });
  const writeRow = (r, label, cells, bold) => {
    ws.getCell(r, 1).value = label;
    if (bold) ws.getCell(r, 1).font = { bold: true };
    let col = 2;
    for (const p of table.periods) {
      const c = cells[p.key];
      for (const [k] of METRICS) {
        const x = ws.getCell(r, col);
        if (k === 'coverage' || k === 'execution') {
          const v = c[k];
          x.value = v == null ? '—' : v;
          if (v != null) x.numFmt = '0.0%';
          const b = c[`${k}Band`];
          if (FILL[b]) x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[b] } };
          x.alignment = { horizontal: 'right' };
        } else x.value = c[k];
        if (bold) x.font = { bold: true };
        col += 1;
      }
    }
  };
  let r = 4;
  for (const row of table.rows) { writeRow(r, row.label || unnamed, row.cells, false); r += 1; }
  writeRow(r, 'Total (sites distincts)', table.total, true);
  ws.getColumn(1).width = 42;
  for (let i = 2; i <= head.length; i += 1) ws.getColumn(i).width = 13;
  ws.getRow(3).height = 45;
  r += 2;
  ws.getCell(r, 1).value = 'Sites comptés une fois par trimestre. Réalisé = visite réalisée ou soumission rattachée au site, pendant un mois où il est actif. « — » : aucun site actif (couverture) ou prévu (exécution).';
  ws.getCell(r, 1).font = { italic: true, size: 9 };
  return wb;
}

module.exports = { buildQuarterlyWorkbook };
