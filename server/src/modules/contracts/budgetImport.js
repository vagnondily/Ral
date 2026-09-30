const ExcelJS = require('exceljs');
const { SECTIONS } = require('./budgetCatalog');

// Parse an uploaded FLA budget workbook (the standard FLA budget
// template) and extract its cost items (postes), so the contract form can be
// pre-filled. Reads the "Détails Section X" sheets, whose columns are:
//   Description | # unités | Coût/unité | Montant | Activité 1..4 (allocation %)
// Sub-section titles (e.g. « Suivi », « Évaluation ») map to the catalogue's
// line codes; the commission de gestion is read from « Budget de l'accord ».

const norm = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function cellVal(cell) {
  const v = cell && cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.result != null) return v.result;              // formula → cached result
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return v.text;
    return '';
  }
  return v;
}
const num = (v) => {
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

// Which section a "Détails …" sheet belongs to.
function sectionForSheet(name) {
  const n = norm(name);
  if (/section i\b|vivres/.test(n)) return 'I';
  if (/section ii\b|cbt/.test(n)) return 'II';
  if (/section iii\b|\bcs\b/.test(n)) return 'III';
  if (/section iv\b|sts/.test(n)) return 'IV';
  if (/couts direct|\bcp\b|section v\b/.test(n)) return 'V';
  return null;
}

// Match a sub-section title to a catalogue line of that section.
function lineForTitle(sectionCode, title) {
  const sec = SECTIONS.find((s) => s.code === sectionCode);
  if (!sec) return null;
  const t = norm(title);
  if (!t) return null;
  let best = null;
  for (const [line, label] of sec.lines) {
    const l = norm(label);
    if (t === l || t.includes(l) || l.includes(t)) { best = `${sectionCode}.${line}`; break; }
    // keyword overlap
    const first = l.split(' ')[0];
    if (first.length > 3 && t.includes(first)) best = best || `${sectionCode}.${line}`;
  }
  return best;
}

function readCommission(wb) {
  const ws = wb.getWorksheet("Budget de l'accord") || wb.worksheets.find((w) => /budget.*accord/i.test(w.name));
  if (!ws) return null;
  let found = null;
  ws.eachRow((row) => {
    let hasCommission = false;
    row.eachCell((cell) => { if (norm(cellVal(cell)).includes('commission')) hasCommission = true; });
    if (hasCommission) {
      row.eachCell((cell) => {
        const n = num(cellVal(cell));
        if (Number.isFinite(n) && n > 0 && n <= 1) found = found ?? n;           // 0.07
        else if (Number.isFinite(n) && n > 1 && n <= 100 && found == null) found = n / 100; // 7 (%)
      });
    }
  });
  return found;
}

// Section-code marker at the start of a cell, e.g. "IV — Services techniques".
// Order matters: IV before V before I so the longest code wins.
const SECTION_MARKER = /^\s*(IV|V|III|II|I)\s*[—–-]/;

/**
 * Parse the workbook produced by our own export (`budgetXlsx.js`): a single
 * « Budget de l'accord » sheet whose columns are
 *   Ligne budgétaire | Désignation (poste) | Nb unités | Coût unitaire | Montant | Activité
 * with merged « I — … » section headers and « Sous-total / Total / Commission »
 * rows. This closes the download → edit offline → re-upload round-trip. Column
 * positions are detected from the header row so a lightly edited file still
 * parses.
 */
function parseBudgetAccord(wb) {
  const ws = wb.getWorksheet("Budget de l'accord") || wb.worksheets.find((w) => /budget.*accord/i.test(w.name));
  if (!ws) return [];

  let headerRow = null;
  const col = { ligne: 1, desc: 2, qty: 3, cost: 4 };
  ws.eachRow((row, idx) => {
    if (headerRow) return;
    const labels = {};
    row.eachCell((cell, c) => { labels[c] = norm(cellVal(cell)); });
    const vals = Object.values(labels);
    const hasUnits = vals.some((v) => v.includes('nb unites') || v.includes('unites') || v.includes('quantite'));
    const hasCost = vals.some((v) => v.includes('cout'));
    if (hasUnits && hasCost) {
      headerRow = idx;
      for (const [c, v] of Object.entries(labels)) {
        if (v.includes('ligne')) col.ligne = Number(c);
        else if (v.includes('designation') || v.includes('poste') || v.includes('description')) col.desc = Number(c);
        else if (v.includes('nb unites') || v.includes('unites') || v.includes('quantite')) col.qty = Number(c);
        else if (v.includes('cout')) col.cost = Number(c);
      }
    }
  });
  if (!headerRow) return [];

  const items = [];
  let currentSection = null;
  let currentLine = null;
  ws.eachRow((row, idx) => {
    if (idx <= headerRow) return;
    const ligne = String(cellVal(row.getCell(col.ligne))).trim();
    const desc = String(cellVal(row.getCell(col.desc))).trim();
    const qtyRaw = cellVal(row.getCell(col.qty));
    const costRaw = cellVal(row.getCell(col.cost));

    // Merged section header (e.g. "IV — Services techniques"). The section code
    // only ever appears in the « ligne » column; a data row carries a line
    // label there instead. (Merged cells report the master value in every
    // column, so we must key off this column alone, not on an empty quantity.)
    const secM = ligne.match(SECTION_MARKER);
    if (secM) { currentSection = secM[1]; currentLine = null; return; }
    if (!currentSection || !desc) return;

    const nd = norm(desc);
    if (nd.startsWith('sous-total') || nd.startsWith('total') || nd.includes('commission') || nd.includes('bareme')) return;

    const qty = num(qtyRaw);
    const cost = num(costRaw);
    const isData = desc.length > 1 && Number.isFinite(qty) && qty > 0 && Number.isFinite(cost) && cost >= 0
      && String(qtyRaw).trim() !== '' && String(costRaw).trim() !== '';
    if (!isData) return;

    const label = ligne.replace(/\[.*?\]/g, '').trim(); // strip "[Suivi/TPM]"
    const sec = SECTIONS.find((s) => s.code === currentSection);
    const mapped = lineForTitle(currentSection, label) || currentLine || `${currentSection}.${sec.lines[0][0]}`;
    currentLine = mapped;
    items.push({ lineCode: mapped, description: desc.slice(0, 240), unitCount: qty, unitCost: cost });
  });
  return items;
}

async function parseFlaBudget(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const items = [];

  for (const ws of wb.worksheets) {
    const sectionCode = sectionForSheet(ws.name);
    if (!sectionCode) continue;
    const sec = SECTIONS.find((s) => s.code === sectionCode);
    let currentLine = `${sectionCode}.${sec.lines[0][0]}`;

    ws.eachRow((row) => {
      const c1 = cellVal(row.getCell(1));
      const c2 = cellVal(row.getCell(2));
      const c3 = cellVal(row.getCell(3));
      const desc = String(c1).trim();
      if (!desc) return;
      const nd = norm(desc);
      if (nd === 'description' || nd === 'total' || nd.startsWith('total')) return;

      const qty = num(c2);
      const cost = num(c3);
      const isData = desc.length > 1 && Number.isFinite(qty) && qty > 0 && Number.isFinite(cost) && cost >= 0
        && String(c2).trim() !== '' && String(c3).trim() !== '';

      if (isData) {
        items.push({ lineCode: currentLine, description: desc.slice(0, 240), unitCount: qty, unitCost: cost });
      } else if (String(c2).trim() === '' && String(c3).trim() === '') {
        // A lone label in column 1 → sub-section title.
        const mapped = lineForTitle(sectionCode, desc);
        if (mapped) currentLine = mapped;
      }
    });
  }

  // Fallback: our own exported « Budget de l'accord » sheet (round-trip).
  if (items.length === 0) items.push(...parseBudgetAccord(wb));

  return { items, feePct: readCommission(wb) };
}

module.exports = { parseFlaBudget, parseBudgetAccord };
