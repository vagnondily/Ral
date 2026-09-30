const ExcelJS = require('exceljs');
const { LINE_CODES, LINE_LABELS, isValidLine } = require('../contracts/budgetCatalog');

/**
 * Shared Excel template + parser for an « état des dépenses » (postes) — used
 * by both the facture and the collection plan, so users can fill data offline.
 *
 * The template embeds Excel data-validation dropdowns for the budget line and
 * the payer, so the system's restrictions are enforced at fill time; the
 * parser re-checks everything (valid line, non-negative amounts, payer) and
 * the caller still runs reportMath.normalizeItems before anything is stored —
 * import can never bypass the business rules.
 */

const BLUE = 'FF1F6EBC';
const money = '#,##0 "Ar"';

// Dropdown value for a line: "CODE — Label" (readable + precise to parse back).
const lineOption = (code) => `${code} — ${LINE_LABELS[code]}`;
const ALL_LINE_OPTIONS = [...LINE_CODES].map(lineOption);

function norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const LABEL_TO_CODE = {};
for (const code of LINE_CODES) LABEL_TO_CODE[norm(LINE_LABELS[code])] = code;

/** Resolve a spreadsheet "Ligne" cell to a catalogue line code, or null. */
function resolveLineCode(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  const head = s.split('—')[0].split('-')[0].trim(); // "IV.suivi — Suivi" → "IV.suivi"
  if (isValidLine(head)) return head;
  if (isValidLine(s)) return s;
  const byLabel = LABEL_TO_CODE[norm(s.includes('—') ? s.split('—').slice(1).join('—') : s)];
  return byLabel || null;
}

function num(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v.result != null) return Number(v.result) || 0;
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function cellText(cell) {
  const v = cell && cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.result != null) return String(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return String(v.text);
    return '';
  }
  return String(v);
}

const HEADERS = ['Ligne budgétaire', 'Désignation (poste)', 'Unité', 'Quantité', 'Coût unitaire', 'À la charge de', 'Observation'];

/**
 * A fillable template workbook. `context` (optional): { title, subtitle }.
 * `sampleItems` (optional): rows to pre-fill (e.g. exporting a plan to edit).
 */
function buildTemplateWorkbook({ title = 'Modèle — État des dépenses', subtitle = '', sampleItems = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MEMS 2.0';
  wb.created = new Date();

  // Reference sheet feeding the dropdowns.
  const ref = wb.addWorksheet('Ref');
  ref.getCell('A1').value = 'Lignes budgétaires';
  ALL_LINE_OPTIONS.forEach((o, i) => { ref.getCell(`A${i + 2}`).value = o; });
  ref.getCell('C1').value = 'À la charge de';
  ref.getCell('C2').value = 'Bailleur';
  ref.getCell('C3').value = 'ONG';
  ref.state = 'veryHidden';

  const ws = wb.addWorksheet('Postes', { views: [{ state: 'frozen', ySplit: 6 }] });
  ws.columns = [
    { width: 40 }, { width: 40 }, { width: 12 }, { width: 10 }, { width: 16 }, { width: 14 }, { width: 28 },
  ];

  ws.mergeCells('A1:G1');
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { size: 15, bold: true, color: { argb: BLUE } };
  ws.getRow(1).height = 24;
  if (subtitle) { ws.mergeCells('A2:G2'); ws.getCell('A2').value = subtitle; ws.getCell('A2').font = { color: { argb: 'FF666B72' } }; }
  ws.mergeCells('A3:G3');
  ws.getCell('A3').value = 'Remplissez une ligne par poste. « Ligne budgétaire » et « À la charge de » se choisissent dans la liste. Montant = Quantité × Coût unitaire (calculé à l\'import).';
  ws.getCell('A3').font = { italic: true, size: 10, color: { argb: 'FF666B72' } };

  const headRow = ws.getRow(6);
  headRow.values = HEADERS;
  headRow.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  headRow.height = 22;

  // Pre-fill sample rows, then leave blank rows — all with validation.
  const firstData = 7;
  const lastData = firstData + Math.max(sampleItems.length, 40) - 1;
  sampleItems.forEach((it, i) => {
    const r = ws.getRow(firstData + i);
    r.getCell(1).value = isValidLine(it.lineCode) ? lineOption(it.lineCode) : '';
    r.getCell(2).value = it.designation || '';
    r.getCell(3).value = it.unit || '';
    r.getCell(4).value = Number(it.unitCount) || 0;
    r.getCell(5).value = Number(it.unitCost) || 0;
    r.getCell(5).numFmt = money;
    r.getCell(6).value = it.payBy === 'ong' ? 'ONG' : 'Bailleur';
    r.getCell(7).value = it.observation || '';
  });

  for (let r = firstData; r <= lastData; r += 1) {
    ws.getCell(`A${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`Ref!$A$2:$A$${ALL_LINE_OPTIONS.length + 1}`],
      showErrorMessage: true, errorStyle: 'stop', error: 'Choisissez une ligne budgétaire dans la liste.',
    };
    ws.getCell(`F${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: ['Ref!$C$2:$C$3'],
      showErrorMessage: true, errorStyle: 'stop', error: 'Bailleur ou ONG.',
    };
    ws.getCell(`D${r}`).dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true, error: 'Quantité ≥ 0.' };
    ws.getCell(`E${r}`).dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true, error: 'Coût ≥ 0.' };
    ws.getCell(`E${r}`).numFmt = money;
  }

  return wb;
}

/** Parse a filled template into raw items (caller runs normalizeItems). */
async function parsePostesWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Postes');
  if (!ws) { const e = new Error('SHEET'); e.code = 'NO_SHEET'; throw e; }

  const items = [];
  const skipped = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= 6) return; // title + header
    const ligne = cellText(row.getCell(1)).trim();
    const designation = cellText(row.getCell(2)).trim();
    const qte = num(row.getCell(4).value);
    const cout = num(row.getCell(5).value);
    if (!ligne && !designation && !qte && !cout) return; // blank row

    const lineCode = resolveLineCode(ligne);
    if (!lineCode) { skipped.push({ row: rowNumber, reason: `Ligne budgétaire non reconnue : « ${ligne || '(vide)'} »` }); return; }
    if (designation.length < 2) { skipped.push({ row: rowNumber, reason: 'Désignation manquante.' }); return; }

    const payText = norm(cellText(row.getCell(6)));
    items.push({
      lineCode,
      designation,
      unit: cellText(row.getCell(3)).trim() || undefined,
      unitCount: qte,
      unitCost: cout,
      payBy: payText.includes('ong') ? 'ong' : 'bailleur',
      observation: cellText(row.getCell(7)).trim() || undefined,
    });
  });

  return { items, skipped };
}

module.exports = { buildTemplateWorkbook, parsePostesWorkbook, HEADERS };
