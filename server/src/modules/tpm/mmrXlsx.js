const ExcelJS = require('exceljs');
const { officeResolver } = require('../common/placeMatch');
const { loadWorkbook } = require('../common/xlsxGuard');

/**
 * Paramètres MMR ⇄ Excel (feuille « Paramètres MMR »), aller-retour :
 * export des lignes stockées avec les champs dérivés en FORMULES vivantes,
 * puis réimport des seules colonnes saisies (les dérivés sont toujours
 * recalculés par mmrMath, jamais relus). Pur (aucune I/O).
 */
const SHEET = 'Paramètres MMR';
const HEADER_ROW = 4;
const GENERAL = 'Plan général';

// [clé, en-tête, largeur] — l'ordre fixe les colonnes A…I (saisies).
const INPUTS = [
  ['scope', 'Portée (Plan général ou code bureau)', 26],
  ['activityCategory', "Catégorie d'activité", 46],
  ['operationDuration', 'Durée (mois/an)', 12],
  ['numberOfSites', 'Nb sites', 10],
  ['riskLevel', 'Risque (1-3)', 11],
  ['personsToDeploy', 'Personnes', 11],
  ['visitsPerDay', 'Suivis/jour/pers.', 13],
  ['workingDays', 'Jours ouvrés/mois', 13],
  ['feasible', 'Faisable saisi (sites/mois)', 15],
  ['note', 'Note', 30],
];
// Dérivés (formules) : mêmes règles que mmrMath.deriveMmr.
const DERIVED = [
  ['Intervalle (mois)', (r) => `IF(E${r}>0,C${r}/E${r},"")`],
  ['Ciblé / mois', (r) => `IF(AND(ISNUMBER(K${r}),K${r}>0),D${r}/K${r},"")`],
  ['Capacité (sites/mois)', (r) => `IF(AND(F${r}>0,G${r}>0,H${r}>0),F${r}*G${r}*H${r},IF(I${r}="","",I${r}))`],
  ['Couverture', (r) => `IF(AND(ISNUMBER(L${r}),L${r}>0,ISNUMBER(M${r})),M${r}/L${r},"")`],
];
const col = (k) => INPUTS.findIndex(([key]) => key === k) + 1;

/**
 * @param {Array<object>} rows    lignes MMR (listMmr) — fieldOfficeId nul = plan général
 * @param {Array<{id,code,name}>} offices  pour écrire le code du bureau et la liste déroulante
 */
function buildMmrWorkbook(rows = [], offices = []) {
  const byId = new Map(offices.map((o) => [o.id, o]));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MEMS 2.0';
  const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: HEADER_ROW, xSplit: 2 }] });
  ws.getCell('A1').value = 'Paramètres MMR — exigences minimales de suivi';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = `Une ligne « ${GENERAL} » par catégorie ; une ligne avec un code bureau = dérogation pour ce bureau. Colonnes grises = calculées (ignorées à l'import).`;
  ws.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF616A7A' } };

  const header = ws.getRow(HEADER_ROW);
  [...INPUTS.map(([, h, w]) => [h, w, false]), ...DERIVED.map(([h]) => [h, 14, true])].forEach(([h, w, derived], i) => {
    const c = header.getCell(i + 1);
    c.value = h; c.font = { bold: true, color: { argb: derived ? 'FF3A4150' : 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: derived ? 'FFE7E9EF' : 'FF0F6CBD' } };
    c.alignment = { wrapText: true, vertical: 'middle' };
    ws.getColumn(i + 1).width = w;
  });
  header.height = 32;

  const scopes = [GENERAL, ...offices.map((o) => o.code)].join(',');
  const sorted = [...rows].sort((a, b) => (a.fieldOfficeId ? 1 : 0) - (b.fieldOfficeId ? 1 : 0)
    || String(a.fieldOfficeName || '').localeCompare(String(b.fieldOfficeName || ''), 'fr')
    || a.activityCategory.localeCompare(b.activityCategory, 'fr'));
  const last = HEADER_ROW + Math.max(sorted.length, 1) + 50; // + lignes libres pour ajouter
  for (let r = HEADER_ROW + 1; r <= last; r += 1) {
    const row = ws.getRow(r);
    const src = sorted[r - HEADER_ROW - 1];
    if (src) {
      const office = src.fieldOfficeId ? byId.get(src.fieldOfficeId) : null;
      row.getCell(1).value = src.fieldOfficeId ? (office ? office.code : src.fieldOfficeName) : GENERAL;
      INPUTS.slice(1).forEach(([k], i) => { const v = src[k]; if (v != null && v !== '') row.getCell(i + 2).value = v; });
    }
    if (scopes.length < 250) row.getCell(1).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${scopes}"`] };
    row.getCell(col('operationDuration')).dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [0, 12], showErrorMessage: true, error: 'Entier entre 0 et 12.' };
    row.getCell(col('riskLevel')).dataValidation = { type: 'list', allowBlank: true, formulae: ['"1,2,3"'], showErrorMessage: true, error: '1 = faible, 2 = moyen, 3 = élevé.' };
    for (const k of ['numberOfSites', 'personsToDeploy', 'feasible']) row.getCell(col(k)).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, error: 'Entier ≥ 0.' };
    row.getCell(col('workingDays')).dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [0, 31] };
    row.getCell(col('visitsPerDay')).dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0] };
    DERIVED.forEach(([, f], i) => {
      const c = row.getCell(INPUTS.length + 1 + i);
      c.value = { formula: f(r) };
      c.numFmt = i === 3 ? '0%' : '0.00';
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F8FB' } };
    });
  }
  return wb;
}

const cellVal = (c) => {
  const v = c && c.value;
  if (v == null) return null;
  if (typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) return v.result != null && typeof v.result !== 'object' ? v.result : null; // erreur Excel ⇒ null
    return v.richText ? v.richText.map((x) => x.text).join('') : v.text ?? null;
  }
  return v;
};
// Formule sans résultat exploitable (ex. COUNTIFS vers un classeur externe : #VALUE!).
const unresolvedFormula = (c) => { const v = c && c.value; return Boolean(v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v) && (v.result == null || typeof v.result === 'object')); };
const str = (c) => { const v = cellVal(c); return v == null ? '' : String(v).trim(); };
const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Colonnes reconnues par leur EN-TÊTE (notre export FR ou la feuille
// « Overreaching Parameters » du classeur RBM). Le premier en-tête qui
// correspond l'emporte (la colonne « Feasible … / Targeted » vient après).
const HEADER_MATCHERS = [
  ['scope', /^portee|field of+ice|^bureau/],
  ['activityCategory', /activity category|categorie d.activite/],
  ['operationDuration', /operation duration|^duree/],
  ['numberOfSites', /number of sites|^nb sites/],
  ['riskLevel', /risk level|^risque/],
  ['feasible', /^feasible number|faisable saisi/],
  ['personsToDeploy', /^personnes/],
  ['visitsPerDay', /suivis ?\/ ?jour/],
  ['workingDays', /jours ouvres/],
  ['note', /^note$/],
];

function findHeader(ws) {
  for (let r = 1; r <= Math.min(ws.actualRowCount || ws.rowCount, 15); r += 1) {
    const map = {};
    ws.getRow(r).eachCell((cell, c) => {
      const h = norm(str(cell));
      for (const [k, re] of HEADER_MATCHERS) if (!map[k] && re.test(h)) { map[k] = c; break; }
    });
    if (map.activityCategory && map.operationDuration && map.riskLevel) return { row: r, map };
  }
  return null;
}

// Rattachement d'une portée à un bureau : moteur partagé (common/placeMatch).
// « RBJ Madagascar, Ampanihy Sub Office » → « Bureau Ampanihy » ; le plus long
// nom « cœur » gagne (pas d'ambiguïté « Fort Dauphin » vs « Dauphin »).

/**
 * Relit les colonnes saisies (les dérivés ne sont jamais relus). Accepte
 * l'export MEMS comme la feuille « Overreaching Parameters » du classeur RBM.
 * Contrôles de forme ; les bornes métier sont revalidées par le zod de la route.
 * @returns {Promise<{ rows, errors: Array<{row,message}>, skipped: Array<{row,message}>, sheet }>}
 */
async function parseMmrWorkbook(buffer, offices = []) {
  const wb = await loadWorkbook(buffer);
  const candidates = [wb.getWorksheet(SHEET), wb.worksheets.find((w) => /overr?each?ing|overarching/i.test(w.name)), ...wb.worksheets].filter(Boolean);
  let ws = null; let header = null;
  for (const w of candidates) { header = findHeader(w); if (header) { ws = w; break; } }
  if (!ws) { const e = new Error('NO_SHEET'); e.code = 'NO_SHEET'; throw e; }
  // Paramètres : un bureau désactivé garde ses dérogations (aller-retour Excel intact).
  const resolve = officeResolver(offices, { includeInactive: true });
  const { map } = header;

  const rows = []; const errors = []; const skipped = []; const seen = new Set();
  for (let r = header.row + 1; r <= ws.actualRowCount + header.row; r += 1) {
    const row = ws.getRow(r);
    const at = (k) => (map[k] ? row.getCell(map[k]) : null);
    const category = str(at('activityCategory'));
    if (!category) continue; // ligne libre
    const scope = str(at('scope'));
    let fieldOfficeId = null;
    if (scope && norm(scope) !== norm(GENERAL)) {
      const o = resolve(scope);
      if (!o) { errors.push({ row: r, message: `Bureau « ${scope} » non reconnu (code ou nom d'un bureau du paramétrage).` }); continue; }
      fieldOfficeId = o.id;
    }
    const num = (k, int = true) => {
      const raw = cellVal(at(k));
      if (raw == null || raw === '' || raw === '-') return null;
      const n = Number(raw);
      return int ? (Number.isInteger(n) ? n : NaN) : n;
    };
    const operationDuration = num('operationDuration'); const riskLevel = num('riskLevel');
    if (operationDuration == null || riskLevel == null) {
      skipped.push({ row: r, message: `« ${category} » non paramétrée (${operationDuration == null ? 'durée' : 'risque'} manquant).` });
      continue;
    }
    const key = `${fieldOfficeId || ''}|${norm(category)}`;
    if (seen.has(key)) { errors.push({ row: r, message: `« ${category} » apparaît deux fois pour la même portée.` }); continue; }
    seen.add(key);
    const out = {
      fieldOfficeId, activityCategory: category, operationDuration, riskLevel,
      numberOfSites: num('numberOfSites') ?? 0,
      // Nb sites non calculé dans le fichier : l'écran le reprend du référentiel.
      numberOfSitesMissing: unresolvedFormula(at('numberOfSites')) || undefined,
      personsToDeploy: num('personsToDeploy'), visitsPerDay: num('visitsPerDay', false),
      workingDays: num('workingDays'), feasible: num('feasible'),
      note: str(at('note')) || undefined,
    };
    const bad = Object.entries(out).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v)).map(([k]) => k);
    if (bad.length) { errors.push({ row: r, message: `Valeur non numérique ou non entière : ${bad.join(', ')}.` }); continue; }
    rows.push(out);
  }
  return { rows, errors, skipped, sheet: ws.name };
}

module.exports = { buildMmrWorkbook, parseMmrWorkbook, officeResolver, GENERAL };
