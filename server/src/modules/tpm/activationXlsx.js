const ExcelJS = require('exceljs');
const { loadWorkbook } = require('../common/xlsxGuard');
const { existingRows, rowValues, MAX_TABLE_COLUMNS } = require('../common/sheetRows');
const { MONTH_HEADERS, MONTHS, parseYesNo, yesNo, identifierOf } = require('./activationMath');

/**
 * Classeur d'activation (retour n° 64) ⇄ grille « Sites (actifs / inactifs) ». PUR.
 *
 * Fidèle à la feuille « Site Actif » du classeur de référence : mêmes colonnes,
 * même ordre, ligne 2 d'instructions, Identifiant = Code POI & Tag_code et
 * Actif = au moins un mois à « Oui » en formules vivantes (avec leur résultat,
 * lisible sans recalcul), listes « Oui / Non » sur les mois, volets figés.
 * Import : colonnes reconnues par leur en-tête ; une cellule de mois vide
 * laisse le mois INCHANGÉ (jamais d'effacement involontaire) ; rien d'écrit ici.
 */
const SHEET = 'Site Actif';
const HEADERS = ['Identifiant', 'Localité', 'Code POI', 'Field_office', 'Field_office_code', 'Region', 'Adm1Code', 'District',
  'Adm2Code', 'Commune', 'Adm3Code', 'Fokontany', 'Adm4Code', 'Activity_tag', 'Tag_code', 'Lat', 'Long', 'Année', 'Actif',
  ...MONTH_HEADERS, 'Motif du changement', 'ID MEMS'];
const COL = Object.fromEntries(HEADERS.map((h, i) => [h, i + 1]));
const FIRST_MONTH = COL.Jan; // T
const LAST_MONTH = COL['Déc']; // AE
const HINTS = {
  Identifiant: 'Ne pas modifier : c\'est la clé de rapprochement',
  Année: 'rempli, ne pas modifier',
  Actif: 'calculé (au moins un mois à Oui)',
  'Motif du changement': 'Pourquoi ce site sort du plan, ou y entre. Facultatif, mais relu longtemps après.',
  'ID MEMS': 'identifiant du site dans MEMS, ne pas modifier',
};
const colLetter = (n) => { let s = ''; let x = n; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; };

/**
 * @param {{ year:number, sites:Array<object>, office?:string, generatedAt?:string }} input
 *   site : { code, locationId, tagCode, name, officeName, officeCode, adm1, adm1Pcode, district, adm2Pcode, commune,
 *            adm3Pcode, fokontany, adm4Pcode, activity, lat, lng, months:{1..12:boolean}, reason }
 */
function buildActivationWorkbook({ year, sites = [], office = 'tous les bureaux', generatedAt = null }) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'MEMS 2.0';
  const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });
  ws.addRow(HEADERS);
  ws.addRow(HEADERS.map((h) => HINTS[h] || (MONTH_HEADERS.includes(h) ? 'Oui / Non' : 'modifiable')));
  const head = ws.getRow(1); head.font = { bold: true }; head.alignment = { vertical: 'middle', wrapText: true }; head.height = 30;
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E9EF' } }; });
  const hint = ws.getRow(2); hint.font = { italic: true, size: 9, color: { argb: 'FF616A7A' } }; hint.alignment = { wrapText: true, vertical: 'top' };
  hint.height = 42;
  const L = (h) => colLetter(COL[h]);
  sites.forEach((s, i) => {
    const r = i + 3;
    const months = MONTHS.map((m) => yesNo(s.months ? s.months[m] : undefined));
    const active = months.includes('Oui') ? 'Oui' : 'Non';
    const row = ws.addRow([
      // Sans Code POI, l'identifiant est le code MEMS, écrit tel quel (une formule le perdrait au recalcul).
      s.locationId ? { formula: `${L('Code POI')}${r}&${L('Tag_code')}${r}`, result: identifierOf(s) } : identifierOf(s),
      s.name || '', s.locationId || '', s.officeName || '', s.officeCode || '', s.adm1 || '', s.adm1Pcode || '',
      s.district || '', s.adm2Pcode || '', s.commune || '', s.adm3Pcode || '', s.fokontany || '', s.adm4Pcode || '',
      s.activity || '', s.tagCode || '',
      s.lat == null ? null : Number(s.lat), s.lng == null ? null : Number(s.lng), year,
      { formula: `IF(COUNTIF(${L('Jan')}${r}:${L('Déc')}${r},"Oui")>0,"Oui","Non")`, result: active },
      ...months, s.reason || '', s.publicId || '',
    ]);
    for (let c = FIRST_MONTH; c <= LAST_MONTH; c += 1) {
      row.getCell(c).dataValidation = {
        type: 'list', allowBlank: true, formulae: ['"Oui,Non"'], showErrorMessage: true,
        errorTitle: 'Oui ou Non', error: 'Saisissez Oui (site actif ce mois) ou Non (inactif).',
      };
      row.getCell(c).alignment = { horizontal: 'center' };
    }
  });
  const widths = { 'ID MEMS': 14, Identifiant: 24, Localité: 26, 'Code POI': 18, Field_office: 16, Region: 16, District: 18, Commune: 18, Fokontany: 18, Activity_tag: 30, 'Motif du changement': 40 };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[h] || (MONTH_HEADERS.includes(h) ? 6 : 11); });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };

  const meta = wb.addWorksheet('_mems');
  meta.state = 'veryHidden';
  [['kind', 'activation'], ['year', year], ['office', office], ['generatedAt', generatedAt || '']].forEach((r) => meta.addRow(r));
  return wb;
}

const fold = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Texte d'une cellule ExcelJS (formule → résultat, texte riche, date, nombre). */
function cellText(cell) {
  if (!cell) return '';
  const v = cell.value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return v.result == null ? '' : String(v.result).trim();
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('').trim();
    if ('text' in v) return String(v.text).trim();
    return '';
  }
  return String(v).trim();
}

// En-têtes reconnus (accents, casse et espaces ignorés).
const FIELD_ALIASES = {
  ident: ['identifiant', 'id', 'identifier'],
  name: ['localite', 'localité', 'site', 'nom du site'],
  codePoi: ['code poi', 'code_poi', 'poi code'],
  tagCode: ['tag_code', 'tag code'],
  year: ['annee', 'année', 'year', 'exercice'],
  reason: ['motif du changement', 'motif'],
  publicId: ['id mems', 'identifiant mems'],
};
const MONTH_ALIASES = [
  ['jan', 'janv', 'janvier', 'january'], ['fev', 'fevr', 'fevrier', 'feb', 'february'], ['mar', 'mars', 'march'],
  ['avr', 'avril', 'apr', 'april'], ['mai', 'may'], ['juin', 'jun', 'june'], ['juil', 'juillet', 'jul', 'july'],
  ['aout', 'aug', 'august'], ['sep', 'sept', 'septembre', 'september'], ['oct', 'octobre', 'october'],
  ['nov', 'novembre', 'november'], ['dec', 'decembre', 'december'],
];

function headerMap(row) {
  const map = {}; const months = {};
  rowValues(row, Math.min(row.cellCount, MAX_TABLE_COLUMNS), (cell) => cell).forEach((cell, i) => {
    const h = fold(cellText(cell));
    if (!h) return;
    for (const [k, list] of Object.entries(FIELD_ALIASES)) if (!map[k] && list.map(fold).includes(h)) map[k] = i + 1;
    MONTH_ALIASES.forEach((list, m) => { if (!months[m + 1] && list.includes(h)) months[m + 1] = i + 1; });
  });
  return { map, months };
}

/**
 * @param {Buffer} buffer
 * @returns {Promise<{ sheet:string, year:number|null, rows:Array<{line, ident, codePoi, tagCode, name, months, reason}>,
 *                     errors:Array<{line,message}>, warnings:Array<{line,message}> }>}
 *   rows[].months ne porte QUE les mois remplis (Oui → true, Non → false).
 */
async function parseActivationWorkbook(buffer) {
  const wb = await loadWorkbook(buffer);
  let found = null;
  const candidates = [wb.getWorksheet(SHEET), ...wb.worksheets].filter((w) => w && w.state !== 'veryHidden');
  for (const ws of candidates) {
    const last = Math.min(ws.rowCount, 6);
    for (let r = 1; r <= last && !found; r += 1) {
      const row = ws.findRow(r); if (!row) continue;
      const h = headerMap(row);
      if ((h.map.ident || h.map.codePoi) && Object.keys(h.months).length === 12) found = { ws, r, ...h };
    }
    if (found) break;
  }
  if (!found) { const e = new Error('NO_SHEET'); e.code = 'NO_SHEET'; throw e; }

  let metaYear = null;
  const meta = wb.getWorksheet('_mems');
  if (meta) {
    for (const { row } of existingRows(meta, 1)) {
      if (fold(cellText(row.findCell(1))) === 'year') metaYear = Number(cellText(row.findCell(2))) || null;
    }
  }

  const { ws, r: headRow, map, months } = found;
  const rows = []; const errors = []; const warnings = []; const years = new Set();
  const at = (row, k) => (map[k] ? row.findCell(map[k]) : null);
  for (const { row, r } of existingRows(ws, headRow + 1)) {
    const monthCells = MONTHS.map((m) => cellText(row.findCell(months[m])));
    // Ligne d'instructions (« Oui / Non ») sous l'en-tête : ignorée.
    if (monthCells.every((t) => fold(t) === 'oui / non' || t === '')) {
      if (monthCells.some((t) => t !== '')) continue;
    }
    const codePoi = cellText(at(row, 'codePoi'));
    const tagCode = cellText(at(row, 'tagCode'));
    let ident = cellText(at(row, 'ident'));
    // Formule de l'identifiant jamais recalculée (fichier produit sans Excel) : Code POI & Tag_code.
    if (!ident || /^ne pas modifier/i.test(ident)) ident = codePoi ? `${codePoi}${tagCode}` : '';
    const name = cellText(at(row, 'name'));
    if (!ident && !name && monthCells.every((t) => t === '')) continue; // ligne vide
    if (!ident) { errors.push({ line: r, message: `${name ? `« ${name} » : ` : ''}Identifiant et Code POI vides — ligne ignorée (renseignez le Code POI du site).` }); continue; }
    const yearText = cellText(at(row, 'year'));
    if (yearText) years.add(Number(yearText));
    const monthsOut = {};
    monthCells.forEach((t, i) => {
      const p = parseYesNo(t);
      if (!p.ok) errors.push({ line: r, message: `${MONTH_HEADERS[i]} : « ${t} » — Oui ou Non attendu.` });
      else if (p.value !== null) monthsOut[i + 1] = p.value;
    });
    rows.push({ line: r, ident, codePoi, tagCode, name, months: monthsOut, reason: cellText(at(row, 'reason')) || null,
      ...(map.publicId ? { publicId: cellText(at(row, 'publicId')) || null } : {}) });
  }
  const fileYears = [...years].filter(Number.isFinite);
  if (fileYears.length > 1) errors.push({ line: null, message: `Plusieurs exercices dans le fichier (${fileYears.sort().join(', ')}) : un seul par import.` });
  return { sheet: ws.name, year: fileYears.length === 1 ? fileYears[0] : metaYear, rows, errors, warnings };
}

module.exports = { SHEET, HEADERS, buildActivationWorkbook, parseActivationWorkbook, cellText };
