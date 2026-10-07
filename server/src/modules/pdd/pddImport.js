const ExcelJS = require('exceljs');

/**
 * Parseur de la feuille « PDD base » (Plan de Distribution d'urgence).
 * En-tête à la ligne 5, données à partir de la 6. Lit les RÉSULTATS des
 * formules (bénéficiaires, tonnages). Pur ; l'insertion est faite par le repo.
 */
const val = (c) => {
  const v = c && c.value;
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v.result != null) return v.result;
    if (v.richText) return v.richText.map((x) => x.text).join('');
    if (v.text != null) return v.text;
    return null;
  }
  return v;
};
const s = (c) => { const v = val(c); return v == null ? '' : String(v).trim(); };
const num = (c) => { const v = Number(val(c)); return Number.isFinite(v) ? v : 0; };

const MONTHS = { janvier: 1, 'février': 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, 'août': 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, 'décembre': 12, decembre: 12 };
// Colonnes denrées (code → libellé), tonnage en MT.
const COMMODITIES = [[27, 'Riz'], [28, 'Mais concassé'], [29, 'Mais en grain'], [30, 'Sorgho'], [31, 'LS'], [32, 'Huile'], [33, 'MNP'], [34, 'P Sup'], [35, 'CSB+'], [36, 'CSB++'], [37, 'P Doz'], [38, 'LNS-sq'], [39, 'Dattes'], [40, 'HEB']];
const r3 = (n) => Math.round(n * 1000) / 1000;

function findHeaderRow(ws) {
  for (let r = 1; r <= Math.min(ws.rowCount, 12); r += 1) {
    const row = ws.getRow(r); let hasMois = false; let hasCommune = false;
    for (let c = 1; c <= Math.min(ws.columnCount, 50); c += 1) {
      const t = s(row.getCell(c)).toLowerCase();
      if (t === 'mois') hasMois = true;
      if (t === 'commune') hasCommune = true;
    }
    if (hasMois && hasCommune) return r;
  }
  return 5;
}

async function parsePddWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('PDD base') || wb.worksheets.find((w) => {
    for (let c = 1; c <= Math.min(w.columnCount, 50); c += 1) if (s(w.getRow(5).getCell(c)).toLowerCase() === 'commune') return true;
    return false;
  });
  if (!ws) return { rows: [], skipped: 0, sheet: null };
  const h = findHeaderRow(ws);
  const rows = []; let skipped = 0;
  for (let r = h + 1; r <= ws.actualRowCount; r += 1) {
    const row = ws.getRow(r);
    const region = s(row.getCell(14)); const district = s(row.getCell(15)); const commune = s(row.getCell(16));
    const activity = s(row.getCell(7)) || s(row.getCell(4));
    if ((!district && !commune) || !activity) { skipped += 1; continue; }
    const mName = s(row.getCell(1)).toLowerCase(); const month = MONTHS[mName] || 0;
    const year = num(row.getCell(2)) || new Date().getFullYear();
    const items = {};
    for (const [c, name] of COMMODITIES) { const q = num(row.getCell(c)); if (q > 0) items[name] = r3(q); }
    const hazard = /cyclone/i.test(activity) ? 'cyclone' : (/drought|sech/i.test(activity) ? 'drought' : 'autre');
    rows.push({
      month, year, periodMonth: month ? `${year}-${String(month).padStart(2, '0')}-01` : null,
      activity, hazard, wbs: s(row.getCell(3)) || null, antenne: s(row.getCell(10)) || null, sousBureau: s(row.getCell(11)) || null,
      partner: s(row.getCell(12)) || null, corridor: s(row.getCell(13)) || null, region, district, commune,
      modality: s(row.getCell(22)) || null, beneficiaries: Math.round(num(row.getCell(20))), households: Math.round(num(row.getCell(21))),
      cashUsd: r3(num(row.getCell(43))), totalFood: r3(num(row.getCell(41))), items,
    });
  }
  return { rows: rows.filter((x) => x.periodMonth), skipped, sheet: ws.name };
}

module.exports = { parsePddWorkbook, COMMODITIES };
