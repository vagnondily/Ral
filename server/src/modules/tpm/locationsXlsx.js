const ExcelJS = require('exceljs');
const { normalizeSecurity } = require('./rbmScore');
const { loadWorkbook } = require('../common/xlsxGuard');
const { existingRows, rowValues, MAX_TABLE_COLUMNS } = require('../common/sheetRows');

/**
 * Registre des sites ⇄ Excel au format du classeur du plan de suivi (feuille
 * « Locations Management » + « Settings » + « Sheet4 »). PUR.
 * Export : en-têtes identiques (ligne 3), exercice en AL2, Status et code de
 * sous-type en formules vivantes, listes déroulantes par noms définis, volets
 * figés en G4, grille de planification (Z:AK, P = prévue / R = réalisée) et
 * grille de statut mensuel (AL:AW, Active/Inactive). Import : colonnes
 * reconnues par en-tête, contrôles par ligne (numéro + motif), rien d'écrit ici.
 *
 * Libellés neutres (aucune marque) ; les libellés d'origine sont acceptés à
 * l'import et convertis (alias).
 */
const POI_SUBTYPES = [
  ['Airport', 'APT'], ['Food Distribution Point', 'FDP'], ['Hospital / health facility', 'HEAL'], ['Market', 'MKT'],
  ['Mobile Storage Unit (MSU)', 'MSU'], ['Partner Warehouse', 'CP_WH'], ['Port', 'PT'], ['Railway Station', 'TRN'],
  ['Refugee Camp', 'CMP'], ['School', 'SCH'], ['Shop / Retailer', 'SH'], ['Storage facility', 'STOR'],
  ['Telecommunication site', 'PRG_TC'], ['Programme Guesthouse', 'PRG_GH'], ['Programme Office', 'PRG_OFF'],
  ['Programme Warehouse', 'PRG_ST'], ['Programme Workshop', 'PRG_WS'],
];
// Libellés d'origine → libellés neutres.
const POI_ALIASES = { 'wfp guesthouse': 'Programme Guesthouse', 'wfp office': 'Programme Office', 'wfp warehouse': 'Programme Warehouse', 'wfp workshop': 'Programme Workshop' };
const MODALITIES = ['Cash', 'Voucher', 'Food', 'Capacity Strengthening', 'Mix'];
const HEAD_ROW = 3;
const FIRST = HEAD_ROW + 1;
const HEADERS = ['ID', 'Status', 'Point of Interest', 'POI Subtypes', 'POI Subtypes Code', 'Activity Tag', 'Sub Office',
  'Admin level 1', 'Admin level 2', 'Admin level 3', 'Urban Area', 'GPS-Lattitude', 'GPS-Longitude', 'Security situation',
  'Programme synergies', 'Modality type', 'Beneficiary number', 'New Partner ', 'Experienced Partner', 'Last visit date',
  'Issues from internal process monitoring ', 'Partner report issue', 'CFM issue', 'Fraud and corruption', 'Score'];
const PLAN_COL = 26; // Z
const STATUS_COL = 38; // AL
const SHEET4 = ['Security situation\n0 = No restriction, 1 = Moderate restriction, 3 = Strict restriction, 99 = Forbidden area',
  'Programme synergies\n0=only 1 activity in the community\n1=more than 1 activity', 'Modality type\nCash, Voucher, Food, Capacity Strengthening,  Mix',
  'Beneficiary number', 'New Partner \n0=Partner with experience \n1=New partner',
  'Experienced Partner\n0=Experienced partner with good experience\n1=Experienced partner with average experience \n2=Experienced partner with poor problems',
  'Last visit date', 'Issues from internal process monitoring \nNo issue=0\nYes important=1\nYes urgent=2', 'Partner report issue\nNo issue=0\nYes important=1\nYes urgent=2 ',
  'CFM issue \nNo issue=0\nYes important=1\nYes urgent=2 ', 'Fraud and corruption\n0=Partner not suspected \n1= Partner Suspected fraud\n2= Partner who was involved to fraud'];

const colLetter = (n) => { let s = ''; let x = n; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; };
const BLUE = 'FF99CCFF';

/**
 * @param {{ year:number, sites:Array<object>, offices:Array<{name,code,parentCode}> }} input
 *   site : { locationId, name, poiSubtype, activity, officeName, admin1, admin2, admin3, urbanArea, gpsLat, gpsLng,
 *            security, synergies, modalityType, beneficiaryNumber, newPartner, experiencedPartner, lastVisitDate,
 *            issuesProcess, issuesPartnerReport, issuesCFM, fraud, finalScore, monthStatus:{1..12:bool}, visits:{1..12:'planifie'|'realise'} }
 */
/**
 * @param {object} p
 * @param {string[]} [p.activities]      catégories du MMR → liste déroulante « Activity Tag »
 * @param {string}   [p.prefillActivity] gabarit d'activité : Activity Tag prérempli sur les lignes libres
 */
function buildLocationsWorkbook({ year, sites = [], offices = [], activities = [], prefillActivity = null, places = null }) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'MEMS 2.0';
  // ---- Settings
  const st = wb.addWorksheet('Settings');
  const block = (col, title, heads, rows) => {
    st.getCell(3, col).value = title; st.getCell(3, col).font = { bold: true };
    heads.forEach((h, i) => { const c = st.getCell(4, col + i); c.value = h; c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }; });
    rows.forEach((r, j) => r.forEach((v, i) => { st.getCell(5 + j, col + i).value = v; }));
  };
  block(1, 'POI Subtypes', ['Description', 'Code'], POI_SUBTYPES);
  block(4, 'Status', ['Description', 'Code'], [['Active', 1], ['Inactive', 0]]);
  block(7, 'Bureau', ['Description', 'Code', 'Sub Office'], offices.map((o) => [o.name, o.code, o.parentCode || null]));
  if (activities.length) block(11, 'Activity Tag', ['Description'], activities.map((a) => [a]));
  [1, 4, 7, 11].forEach((c) => { st.getColumn(c).width = 28; });
  const poiEnd = 4 + POI_SUBTYPES.length; const offEnd = 4 + Math.max(offices.length, 1);
  wb.definedNames.add(`Settings!$A$5:$A$${poiEnd}`, 'pois');
  wb.definedNames.add('Settings!$D$5:$D$6', 'status');
  wb.definedNames.add(`Settings!$G$5:$G$${offEnd}`, 'offices');
  if (activities.length) wb.definedNames.add(`Settings!$K$5:$K$${4 + activities.length}`, 'activities');

  // ---- Lieux : régions, districts et communes du découpage (Paramétrage › Localités), en listes
  // déroulantes des colonnes Admin level 1-3. Avertissement seulement : un nom hors liste reste
  // possible (il sera rapproché à l'import, ou proposé dans « À rapprocher »).
  const placeLists = [['regions', places && places.regions], ['districts', places && places.districts], ['communes', places && places.communes]]
    .filter(([, list]) => list && list.length);
  if (placeLists.length) {
    const lx = wb.addWorksheet('Lieux', { state: 'hidden' });
    placeLists.forEach(([name, list], i) => {
      lx.getCell(1, i + 1).value = name;
      list.forEach((v, j) => { lx.getCell(j + 2, i + 1).value = v; });
      wb.definedNames.add(`Lieux!$${colLetter(i + 1)}$2:$${colLetter(i + 1)}$${list.length + 1}`, name);
    });
  }
  const placeCol = { 8: 'regions', 9: 'districts', 10: 'communes' };

  // ---- Locations Management
  const ws = wb.addWorksheet('Locations Management', { views: [{ state: 'frozen', xSplit: 6, ySplit: HEAD_ROW }] });
  ws.mergeCells(2, STATUS_COL, 2, STATUS_COL + 11);
  ws.getCell(2, STATUS_COL).value = year; ws.getCell(2, STATUS_COL).alignment = { horizontal: 'center' }; ws.getCell(2, STATUS_COL).font = { bold: true };
  ws.mergeCells(2, PLAN_COL, 2, PLAN_COL + 11);
  ws.getCell(2, PLAN_COL).value = `Plan ${year} (P = prévue, R = réalisée)`; ws.getCell(2, PLAN_COL).alignment = { horizontal: 'center' };
  const head = ws.getRow(HEAD_ROW);
  HEADERS.forEach((h, i) => { head.getCell(i + 1).value = h; });
  for (let m = 1; m <= 12; m += 1) { head.getCell(PLAN_COL + m - 1).value = m; head.getCell(STATUS_COL + m - 1).value = m; }
  head.eachCell((c, col) => {
    c.font = { bold: true }; c.alignment = { wrapText: true, vertical: 'middle' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col === 12 || col === 13 ? 'FF00B0F0' : (col >= STATUS_COL ? 'FFFFFF99' : BLUE) } };
  });
  head.height = 42;
  [8, 8, 34, 24, 10, 34, 22, 16, 18, 18, 14, 12, 12, 10, 10, 14, 11, 9, 11, 12, 12, 10, 9, 10, 8].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (let c = PLAN_COL; c < STATUS_COL + 12; c += 1) ws.getColumn(c).width = 5.8;

  const rows = Math.max(sites.length, 1) + 200; // lignes libres pour ajouter des sites
  for (let k = 0; k < rows; k += 1) {
    const r = FIRST + k; const row = ws.getRow(r); const s = sites[k];
    const sl = `${colLetter(STATUS_COL)}${r}:${colLetter(STATUS_COL + 11)}${r}`;
    row.getCell(2).value = { formula: `IFERROR(LOOKUP(2,1/(${sl}<>""),${sl}),"")` };
    row.getCell(5).value = { formula: `IFERROR(VLOOKUP($D${r},Settings!$A$4:$B$${poiEnd},2,0),"")` };
    row.getCell(4).dataValidation = { type: 'list', allowBlank: true, formulae: ['pois'], showErrorMessage: true };
    row.getCell(7).dataValidation = { type: 'list', allowBlank: true, formulae: ['offices'], showErrorMessage: true };
    if (activities.length) row.getCell(6).dataValidation = { type: 'list', allowBlank: true, formulae: ['activities'], showErrorMessage: true };
    for (const [c, name] of Object.entries(placeCol)) {
      if (placeLists.some(([n]) => n === name)) {
        row.getCell(Number(c)).dataValidation = { type: 'list', allowBlank: true, formulae: [name], showErrorMessage: true, errorStyle: 'warning',
          errorTitle: 'Lieu hors du découpage', error: 'Ce nom n\'est pas dans le découpage de MEMS : il sera rapproché à l\'import ou proposé à valider.' };
      }
    }
    row.getCell(14).dataValidation = { type: 'list', allowBlank: true, formulae: ['"0,1,3,99"'], showErrorMessage: true };
    row.getCell(16).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${MODALITIES.join(',')}"`], showErrorMessage: true };
    for (const c of [15, 18]) row.getCell(c).dataValidation = { type: 'list', allowBlank: true, formulae: ['"0,1"'] };
    for (const c of [19, 21, 22, 23, 24]) row.getCell(c).dataValidation = { type: 'list', allowBlank: true, formulae: ['"0,1,2"'] };
    for (let m = 0; m < 12; m += 1) {
      row.getCell(STATUS_COL + m).dataValidation = { type: 'list', allowBlank: true, formulae: ['status'], showErrorMessage: true };
      row.getCell(PLAN_COL + m).dataValidation = { type: 'list', allowBlank: true, formulae: ['"P,R"'] };
    }
    if (!s) { if (prefillActivity) row.getCell(6).value = prefillActivity; continue; }
    const vals = [s.locationId, null, s.name, s.poiSubtype, null, s.activity, s.officeName, s.admin1, s.admin2, s.admin3, s.urbanArea,
      s.gpsLat, s.gpsLng, s.security ?? 0, s.synergies ?? 0, s.modalityType, s.beneficiaryNumber, s.newPartner ?? 0, s.experiencedPartner ?? 0,
      s.lastVisitDate ? new Date(`${s.lastVisitDate}T00:00:00Z`) : null, s.issuesProcess ?? 0, s.issuesPartnerReport ?? 0, s.issuesCFM ?? 0, s.fraud ?? 0, s.finalScore];
    vals.forEach((v, i) => { if (i !== 1 && i !== 4 && v != null && v !== '') row.getCell(i + 1).value = v; });
    row.getCell(20).numFmt = 'yyyy-mm-dd';
    for (let m = 1; m <= 12; m += 1) {
      const v = s.visits && s.visits[m];
      if (v) row.getCell(PLAN_COL + m - 1).value = v === 'realise' ? 'R' : 'P';
      const a = s.monthStatus && s.monthStatus[m];
      if (a != null) row.getCell(STATUS_COL + m - 1).value = a ? 'Active' : 'Inactive';
    }
  }

  // ---- Sheet4 : dictionnaire des critères
  const d = wb.addWorksheet('Sheet4');
  SHEET4.forEach((h, i) => { const c = d.getCell(1, i + 1); c.value = h; c.alignment = { wrapText: true, vertical: 'top' }; c.font = { bold: true }; d.getColumn(i + 1).width = 26; });
  d.getRow(1).height = 110;
  return wb;
}

// ---- Import ------------------------------------------------------------------------
const val = (c) => { const v = c && c.value; if (v == null) return null; if (typeof v === 'object' && !(v instanceof Date)) { if ('formula' in v || 'sharedFormula' in v) return v.result ?? null; if (v.richText) return v.richText.map((x) => x.text).join(''); return v.text ?? null; } return v; };
const str = (c) => { const v = val(c); return v == null ? '' : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim()); };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const FIELD_MATCHERS = [
  ['id', /^id$/], ['name', /^point of interest$/], ['poi', /^poi subtypes?$/], ['activity', /^activity tag$/], ['office', /^sub ?office$/],
  ['admin1', /^admin level 1$/], ['admin2', /^admin level 2$/], ['admin3', /^admin level 3$/], ['urban', /^urban area$/],
  ['lat', /^gps-?lat/], ['lng', /^gps-?long/], ['security', /^security situation/], ['synergies', /^programme synergies/],
  ['modality', /^modality type/], ['beneficiaries', /^beneficiary number/], ['newPartner', /^new partner/], ['experienced', /^experienced partner/],
  ['lastVisit', /^last visit date/], ['issuesProcess', /^issues from internal/], ['issuesPartner', /^partner report issue/],
  ['issuesCFM', /^cfm issue/], ['fraud', /^fraud and corruption/],
];

function excelDate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const n = Number(v);
  if (Number.isFinite(n) && n > 10000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * @param {Buffer} buffer
 * @param {{ resolveOffice: (name:string) => ({id}|null), activities?: string[] }} ctx
 * @returns {Promise<{ year:number|null, rows:Array<object>, errors:Array<{line,message}>, warnings:Array<{line,message}>, sheet:string }>}
 *   errors = lignes rejetées (valeur invalide) ; warnings = importées mais signalées.
 */
async function parseLocationsWorkbook(buffer, { resolveOffice, activities = [] } = {}) {
  const wb = await loadWorkbook(buffer);
  let ws = wb.getWorksheet('Locations Management'); let hr = null; let map = null;
  const findHead = (w) => {
    // Bornes lues une fois (actualRowCount reparcourt toute la feuille), cellules existantes seulement.
    const lastRow = Math.min(w.rowCount, 10);
    for (let r = 1; r <= lastRow; r += 1) {
      const m = {}; const row = w.findRow(r); if (!row) continue;
      rowValues(row, Math.min(row.cellCount, MAX_TABLE_COLUMNS), (cell) => cell).forEach((c, i) => {
        const h = norm(str(c)); for (const [k, re] of FIELD_MATCHERS) if (!m[k] && re.test(h)) m[k] = i + 1;
      });
      if (m.name && m.activity && m.office) return { r, m };
    }
    return null;
  };
  for (const w of [ws, ...wb.worksheets].filter(Boolean)) { const f = findHead(w); if (f) { ws = w; hr = f.r; map = f.m; break; } }
  if (!map) { const e = new Error('NO_SHEET'); e.code = 'NO_SHEET'; throw e; }
  // Grilles mois : premières colonnes « 1 » des deux blocs 1..12 (plan puis statut).
  const head = ws.getRow(hr); const ones = [];
  rowValues(head, Math.min(head.cellCount, MAX_TABLE_COLUMNS), (cell) => cell).forEach((c, i) => {
    if (Number(val(c)) === 1 && Number(val(head.findCell(i + 12))) === 12) ones.push(i + 1);
  });
  const statusCol = ones.length ? ones[ones.length - 1] : null; const planCol = ones.length > 1 ? ones[0] : null;
  const year = statusCol && hr > 1 ? Number(val(ws.findRow(hr - 1)?.findCell(statusCol))) || null : null;
  const actSet = new Map(activities.map((a) => [norm(a), a]));

  const rows = []; const errors = []; const warnings = []; const seenIds = new Set();
  const at = (row, k) => (map[k] ? row.getCell(map[k]) : null);
  const scale = (row, k, allowed, line, label) => {
    const raw = str(at(row, k)); if (raw === '') return 0;
    const n = Number(raw);
    if (!allowed.includes(n)) { errors.push({ line, message: `${label} : « ${raw} » hors échelle (${allowed.join(', ')}).` }); return null; }
    return n;
  };
  // Jusqu'à la DERNIÈRE ligne de la feuille : des lignes vides dans le tableau ne font rien perdre.
  for (const { row, r } of existingRows(ws, hr + 1)) {
    const name = str(at(row, 'name'));
    if (!name) continue;
    const line = r; const before = errors.length;
    const id = str(at(row, 'id')).toUpperCase() || null;
    if (id && !/^L\d{3,6}$/.test(id)) errors.push({ line, message: `ID « ${id} » invalide (format L001).` });
    if (id && seenIds.has(id)) errors.push({ line, message: `ID ${id} en double dans le fichier.` });
    if (id) seenIds.add(id);
    const officeName = str(at(row, 'office'));
    const office = officeName ? resolveOffice(officeName) : null;
    // Vide autorisé (comme dans le classeur) mais signalé ; valeur inconnue = ligne rejetée.
    if (!officeName) warnings.push({ line, message: 'Sub Office vide : site sans bureau.' });
    else if (!office) errors.push({ line, message: `Sub Office « ${officeName} » inconnu (Paramétrage › Bureaux).` });
    // Activité : libellé canonique du MMR si elle y figure. Sinon la ligne est importée telle
    // quelle et signalée (sans visite exigée) — un registre existant se réimporte sans perte.
    const actRaw = str(at(row, 'activity'));
    const known = actSet.size ? actSet.get(norm(actRaw)) : actRaw;
    const activity = known || actRaw;
    if (!actRaw) warnings.push({ line, message: 'Activity Tag vide : aucune visite exigée par le MMR.' });
    else if (actSet.size && !known) warnings.push({ line, message: `Activity Tag « ${actRaw} » absent du MMR : site importé sans visite exigée (ajoutez la catégorie dans Paramétrage › Paramètres MMR).` });
    const poiRaw = str(at(row, 'poi'));
    const poi = poiRaw ? (POI_ALIASES[norm(poiRaw)] || (POI_SUBTYPES.find(([l]) => norm(l) === norm(poiRaw)) || [])[0]) : null;
    if (poiRaw && !poi) errors.push({ line, message: `POI Subtypes « ${poiRaw} » hors liste.` });
    const secRaw = str(at(row, 'security'));
    const security = secRaw === '' ? 0 : normalizeSecurity(secRaw);
    if (secRaw !== '' && ![0, 1, 3, 99].includes(Number(secRaw))) errors.push({ line, message: `Security situation « ${secRaw} » hors échelle (0, 1, 3, 99).` });
    const modalityRaw = str(at(row, 'modality'));
    const modality = modalityRaw ? MODALITIES.find((m) => norm(m) === norm(modalityRaw)) : null;
    if (modalityRaw && !modality) errors.push({ line, message: `Modality type « ${modalityRaw} » hors liste.` });
    const benRaw = str(at(row, 'beneficiaries'));
    const beneficiaryNumber = benRaw === '' ? null : Number(benRaw);
    if (benRaw !== '' && !(Number.isInteger(beneficiaryNumber) && beneficiaryNumber >= 0)) errors.push({ line, message: `Beneficiary number « ${benRaw} » invalide.` });
    const lat = str(at(row, 'lat')) === '' ? null : Number(str(at(row, 'lat')));
    const lng = str(at(row, 'lng')) === '' ? null : Number(str(at(row, 'lng')));
    if ((lat != null && !(lat >= -90 && lat <= 90)) || (lng != null && !(lng >= -180 && lng <= 180))) errors.push({ line, message: 'Coordonnées GPS invalides.' });
    const monthStatus = {}; const planned = [];
    for (let m = 0; m < 12; m += 1) {
      if (statusCol) { const v = norm(str(row.getCell(statusCol + m))); if (v === 'active' || v === '1') monthStatus[m + 1] = true; else if (v === 'inactive' || v === '0') monthStatus[m + 1] = false; else if (v) errors.push({ line, message: `Statut du mois ${m + 1} « ${v} » : Active ou Inactive attendu.` }); }
      if (planCol) { const v = norm(str(row.getCell(planCol + m))); if (v === 'p' || v === 'x' || v === '1') planned.push(m + 1); }
    }
    const rec = {
      line, locationId: id, name, poiSubtype: poi, activity: activity || actRaw || null, officeId: office ? office.id : null,
      admin1: str(at(row, 'admin1')) || null, admin2: str(at(row, 'admin2')) || null, admin3: str(at(row, 'admin3')) || null,
      urbanArea: str(at(row, 'urban')) || null, gpsLat: lat, gpsLng: lng, security,
      synergies: scale(row, 'synergies', [0, 1], line, 'Programme synergies'), modalityType: modality || null, beneficiaryNumber,
      newPartner: scale(row, 'newPartner', [0, 1], line, 'New Partner'), experiencedPartner: scale(row, 'experienced', [0, 1, 2], line, 'Experienced Partner'),
      lastVisitDate: excelDate(val(at(row, 'lastVisit'))),
      issuesProcess: scale(row, 'issuesProcess', [0, 1, 2], line, 'Issues (process monitoring)'), issuesPartnerReport: scale(row, 'issuesPartner', [0, 1, 2], line, 'Partner report issue'),
      issuesCFM: scale(row, 'issuesCFM', [0, 1, 2], line, 'CFM issue'), fraud: scale(row, 'fraud', [0, 1, 2], line, 'Fraud and corruption'),
      monthStatus, planned,
    };
    if (errors.length === before) rows.push(rec);
  }
  return { year, rows, errors, warnings, sheet: ws.name };
}

module.exports = { buildLocationsWorkbook, parseLocationsWorkbook, POI_SUBTYPES, MODALITIES, HEADERS };
