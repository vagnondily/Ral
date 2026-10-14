/**
 * Modèle / export / import Excel du registre des sites (page Paramétrage › Sites).
 * En-têtes FIDÈLES à la demande utilisateur :
 *   Identifiant | Localité | Code POI | Field_office | Field_office_code |
 *   Region | Adm1Code | District | Adm2Code | Commune | Adm3Code |
 *   Fokontany | Adm4Code | Activity_tag | Tag_code | Lat | Long
 *
 * Lecture bornée via common/sheetRows (règle du projet) et garde common/xlsxGuard.
 */
const ExcelJS = require('exceljs');
const { loadWorkbook } = require('../common/xlsxGuard');
const { sheetTable } = require('../common/sheetRows');

const BLUE = 'FF0F6CBD';

// Ordre d'affichage = ordre demandé. `key` = champ interne.
const COLUMNS = [
  { header: 'Identifiant', key: 'identifiant', width: 24 },
  { header: 'Localité', key: 'localite', width: 28 },
  { header: 'Code POI', key: 'codePoi', width: 12 },
  { header: 'Field_office', key: 'fieldOffice', width: 18 },
  { header: 'Field_office_code', key: 'fieldOfficeCode', width: 16 },
  { header: 'Region', key: 'region', width: 18 },
  { header: 'Adm1Code', key: 'adm1Code', width: 12 },
  { header: 'District', key: 'district', width: 18 },
  { header: 'Adm2Code', key: 'adm2Code', width: 12 },
  { header: 'Commune', key: 'commune', width: 18 },
  { header: 'Adm3Code', key: 'adm3Code', width: 12 },
  { header: 'Fokontany', key: 'fokontany', width: 18 },
  { header: 'Adm4Code', key: 'adm4Code', width: 12 },
  { header: 'Activity_tag', key: 'activityTag', width: 16 },
  { header: 'Tag_code', key: 'tagCode', width: 12 },
  { header: 'Lat', key: 'lat', width: 12 },
  { header: 'Long', key: 'lng', width: 12 },
];
const HEADERS = COLUMNS.map((c) => c.header);
const LAST_COL = String.fromCharCode('A'.charCodeAt(0) + COLUMNS.length - 1); // 'Q'

function norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.result != null) return String(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return String(v.text);
    return '';
  }
  return String(v);
}
function numOrNull(v) {
  const t = cellText(v).trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Classeur du registre : modèle vide (sites=[]) ou export (sites renseignés).
 * `title` libre. Les colonnes générées par le système (Code POI, pcodes) sont
 * renseignées à l'export ; à l'import elles sont ignorées (dérivées).
 */
function buildWorkbook({ title = 'Registre des sites — MEMS 2.0', sites = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MEMS 2.0';
  wb.created = new Date();
  const ws = wb.addWorksheet('Sites', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.columns = COLUMNS.map((c) => ({ width: c.width }));

  ws.mergeCells(`A1:${LAST_COL}1`);
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { size: 15, bold: true, color: { argb: BLUE } };
  ws.getRow(1).height = 24;
  ws.mergeCells(`A2:${LAST_COL}2`);
  ws.getCell('A2').value = 'Une ligne par site. Obligatoire : Localité. Lat/Long en degrés décimaux (ex. -23.12 ; 43.70). '
    + 'Code POI, Adm1–Adm4Code sont attribués/déduits par l\'application (ignorés à l\'import). '
    + 'Field_office se rattache par son code. Après import, « Attribuer depuis le GPS » complète la zone.';
  ws.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF666B72' } };
  ws.getCell('A2').alignment = { wrapText: true };
  ws.getRow(2).height = 42;

  const headRow = ws.getRow(4);
  headRow.values = HEADERS;
  headRow.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  headRow.height = 22;

  let r = 5;
  for (const s of sites) {
    const row = ws.getRow(r);
    COLUMNS.forEach((c, i) => { row.getCell(i + 1).value = s[c.key] ?? null; });
    r += 1;
  }
  return wb;
}

/**
 * Parse un classeur rempli → lignes { identifiant, localite, fieldOfficeCode,
 * region, district, commune, fokontany, activityTag, tagCode, lat, lng, _row }.
 * Les colonnes dérivées (Code POI, Adm*Code) sont ignorées. Rien n'est persisté.
 */
async function parseSitesWorkbook(buffer) {
  const wb = await loadWorkbook(buffer);
  const ws = wb.getWorksheet('Sites') || wb.worksheets[0];
  if (!ws) { const e = new Error('SHEET'); e.code = 'NO_SHEET'; throw e; }

  const table = sheetTable(ws, { read: (cell) => cell.value });
  if (table.length === 0) return { rows: [], skipped: [] };

  // Repérer la ligne d'en-tête : celle qui contient « Identifiant » ou « Localité ».
  const headerIdx = table.findIndex((rowVals) => rowVals.some((v) => {
    const n = norm(cellText(v));
    return n === 'identifiant' || n === 'localite' || n === 'localité';
  }));
  if (headerIdx === -1) { const e = new Error('HEADER'); e.code = 'NO_HEADER'; throw e; }

  // Index des colonnes connues par en-tête normalisé.
  const headerRow = table[headerIdx].map((v) => norm(cellText(v)));
  const col = {};
  COLUMNS.forEach((c) => { col[c.key] = headerRow.indexOf(norm(c.header)); });
  // Tolérance : « Long » peut s'écrire « Longitude ».
  if (col.lng === -1) col.lng = headerRow.indexOf('longitude');
  if (col.lat === -1) col.lat = headerRow.indexOf('latitude');

  const get = (vals, key) => (col[key] >= 0 ? cellText(vals[col[key]]).trim() : '');
  const rows = []; const skipped = [];
  for (let i = headerIdx + 1; i < table.length; i += 1) {
    const vals = table[i];
    const localite = get(vals, 'localite');
    const identifiant = get(vals, 'identifiant');
    if (!localite && !identifiant) continue; // ligne vide
    if (!localite) { skipped.push({ row: i + 1, reason: 'Localité manquante.' }); continue; }
    rows.push({
      _row: i + 1,
      identifiant: identifiant || undefined,
      localite,
      fieldOfficeCode: get(vals, 'fieldOfficeCode') || undefined,
      region: get(vals, 'region') || undefined,
      district: get(vals, 'district') || undefined,
      commune: get(vals, 'commune') || undefined,
      fokontany: get(vals, 'fokontany') || undefined,
      activityTag: get(vals, 'activityTag') || undefined,
      tagCode: get(vals, 'tagCode') || undefined,
      lat: col.lat >= 0 ? numOrNull(vals[col.lat]) : null,
      lng: col.lng >= 0 ? numOrNull(vals[col.lng]) : null,
    });
  }
  return { rows, skipped };
}

module.exports = { HEADERS, COLUMNS, buildWorkbook, parseSitesWorkbook };
