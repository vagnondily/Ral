const crypto = require('crypto');
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');
const { MAP } = require('./memsMapping');
const { parseCollectionDate } = require('./collectionDate');
const { parseSav } = require('./savParser');
const { inspectOle } = require('./xlsReader');
const { looksLikeXlsform } = require('./xlsformImport');
const { sniffFile, decodeText, xlsxSheetNames } = require('../common/fileSniff');
const { assertZipEntries, DEFAULT_ZIP_LIMITS } = require('../common/zipGuard');
const { badRequest } = require('../../middleware/errors');

/**
 * Parse a monitoring export into normalized submission rows. The raw answers
 * are kept verbatim in `data`; a few well-known Kobo columns are lifted into
 * typed fields for filtering/grouping. The same shape is produced whatever the
 * source (CSV, XLSX, SPSS .sav, zip SPSS de Kobo, API Kobo/Ona), so every
 * importer feeds the very same insert path.
 *
 * Le FORMAT est reconnu par le contenu (`fileSniff`), jamais par le nom : une
 * page HTML, un PDF, un document Word, un .zsav, un .xls ou la DÉFINITION d'un
 * formulaire (XLSForm) sont refusés avec un message qui nomme le format, AVANT
 * toute écriture. Un zip n'est décompressé qu'après la garde de taille
 * (`zipGuard`). Une date de collecte illisible donne une erreur 400 qui cite
 * la ligne et la colonne, au lieu d'un 500 au moment de l'écriture.
 *
 * The « well-known column → typed field » alias table lives in `memsMapping.js`
 * (single source of truth, shared with the « Mapping MEMS » screen).
 */

const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Forme d'un code de localité (pcode) : 2-3 lettres puis des chiffres (MG51507090).
const PCODE = /^[A-Za-z]{2,3}\d{1,12}$/;
const ADMIN_KEYS = new Set(['admin1', 'admin2', 'admin3', 'admin4']);

/**
 * Colonnes à lever en champs typés. Les alias sont comparés en forme normalisée
 * (accents, casse). Pour un niveau administratif présent sous plusieurs colonnes
 * (ex. admin3 et admin3name), la colonne dont les valeurs ont la forme d'un pcode
 * l'emporte (échantillon `rows`), sinon l'ordre des alias (code d'abord).
 */
function buildLookup(headers, rows = []) {
  const byNorm = new Map();
  headers.forEach((h, i) => { if (h != null && h !== '' && !byNorm.has(norm(h))) byNorm.set(norm(h), i); });
  const sample = rows.slice(0, 50);
  const looksLikePcode = (col) => {
    const vals = sample.map((r) => r[col]).filter((v) => v != null && String(v).trim() !== '');
    return vals.length > 0 && vals.filter((v) => PCODE.test(String(v).trim())).length / vals.length >= 0.8;
  };
  const picks = {};
  for (const [field, aliases] of Object.entries(MAP)) {
    const candidates = aliases.map((a) => byNorm.get(norm(a))).filter((i) => i !== undefined);
    if (!candidates.length) continue;
    const coded = ADMIN_KEYS.has(field) && candidates.length > 1 ? candidates.find(looksLikePcode) : undefined;
    picks[field] = coded !== undefined ? coded : candidates[0];
  }
  return picks;
}

/**
 * Une ligne → une soumission. `badDate` est renseigné quand la colonne de date
 * de collecte contient une valeur illisible (la ligne n'est alors pas gardée).
 * @returns {{ submission: object, badDate: {column:string,value:string}|null }}
 */
function rowToSubmission(headers, values, picks, source) {
  const data = {};
  headers.forEach((h, i) => {
    if (h == null || h === '') return;
    const v = values[i];
    if (v !== undefined && v !== null && v !== '') data[h] = v;
  });
  const at = (field) => (picks[field] != null ? values[picks[field]] : undefined);
  const when = parseCollectionDate(at('submitted_at'));
  const submission = {
    externalId: at('external_id') != null ? String(at('external_id')) : null,
    periodMonth: when.ok ? when.month : null,
    submittedAt: when.ok ? when.date : null,
    fieldOffice: at('field_office') != null ? String(at('field_office')) : null,
    admin1: at('admin1') != null ? String(at('admin1')) : null,
    admin2: at('admin2') != null ? String(at('admin2')) : null,
    admin3: at('admin3') != null ? String(at('admin3')) : null,
    admin4: at('admin4') != null ? String(at('admin4')) : null,
    site: at('site') != null ? String(at('site')) : null,
    partner: at('partner') != null ? String(at('partner')) : null,
    agent: at('agent') != null ? String(at('agent')) : null,
    source,
    data,
  };
  const badDate = when.ok ? null : { column: String(headers[picks.submitted_at]), value: String(at('submitted_at')) };
  return { submission, badDate };
}

const clip = (s, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Erreur 400 « date illisible » : première occurrence en clair (ligne ou
 * enregistrement, colonne, valeur), puis les autres numéros ; liste complète
 * (bornée) dans `details.invalidDates`.
 * @param {Array<{line:number,column:string,value:string}>} bad
 * @param {'line'|'record'} unit  ligne du fichier, ou n° d'enregistrement (SPSS, API)
 */
function invalidDatesError(bad, unit) {
  const where = (n) => (unit === 'record' ? `l'enregistrement n° ${n}` : `la ligne ${n}`);
  const [first] = bad;
  let message = `Date illisible à ${where(first.line)}, colonne « ${first.column} » : « ${clip(first.value)} ». `
    + 'Écrivez les dates au format AAAA-MM-JJ (ex. 2026-01-30), puis réessayez. Rien n\'a été importé.';
  if (bad.length > 1) {
    const others = bad.slice(1, 11).map((b) => b.line).join(', ');
    const more = bad.length > 11 ? ` et ${bad.length - 11} de plus` : '';
    message += ` ${unit === 'record' ? 'Autres enregistrements concernés' : 'Autres lignes concernées'} : ${others}${more}.`;
  }
  return badRequest(message, { invalidDates: bad.slice(0, 100) });
}

/** Lignes d'un tableau → soumissions ; refuse le lot entier si une date est illisible. */
function buildSubmissions(headers, rows, lines, source) {
  const picks = buildLookup(headers, rows);
  const out = []; const bad = [];
  rows.forEach((values, i) => {
    const { submission, badDate } = rowToSubmission(headers, values, picks, source);
    if (badDate) bad.push({ line: lines ? lines[i] : i + 1, ...badDate });
    else if (Object.keys(submission.data).length > 0) out.push(submission);
  });
  if (bad.length) throw invalidDatesError(bad, 'line');
  return out;
}

/** Split a CSV line honoring quotes; delimiter given. */
function splitCsvLine(line, delim) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Séparateur d'après la ligne d'en-tête : tabulation, point-virgule ou virgule (le plus fréquent). */
function pickDelimiter(headerLine) {
  const count = (ch) => headerLine.split(ch).length - 1;
  const tabs = count('\t'); const semis = count(';'); const commas = count(',');
  if (tabs > semis && tabs > commas) return '\t';
  return semis > commas ? ';' : ',';
}

/** CSV → en-têtes + lignes, avec le n° de ligne réel de chaque ligne de données. */
function parseCsv(text) {
  const all = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const used = [];
  all.forEach((l, i) => { if (l.length > 0) used.push(i); });
  if (!used.length) return { headers: [], rows: [], lines: [] };
  const delim = pickDelimiter(all[used[0]]);
  const headers = splitCsvLine(all[used[0]], delim).map((h) => h.trim());
  const data = used.slice(1);
  return { headers, rows: data.map((i) => splitCsvLine(all[i], delim)), lines: data.map((i) => i + 1) };
}

function cellText(cell) {
  const v = cell && cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
    return '';
  }
  return v;
}

/** Première feuille d'un .xlsx → en-têtes + lignes, avec le n° de ligne Excel. */
async function parseXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [], lines: [] };
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, col) => { headers[col - 1] = cellText(c); });
  const rows = []; const lines = [];
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const vals = [];
    let any = false;
    for (let c = 0; c < headers.length; c += 1) {
      const v = cellText(row.getCell(c + 1));
      vals[c] = v;
      if (v !== '') any = true;
    }
    if (any) { rows.push(vals); lines.push(r); }
  }
  return { headers, rows, lines };
}

/**
 * Normalize an array of plain objects (e.g. Kobo v2 API `data.json` records,
 * SPSS cases) into the same submission shape. Group-prefixed keys
 * ("grp/field") are flattened to their leaf name so they match the mapping
 * fields. Une date illisible refuse le lot (400, n° d'enregistrement).
 */
function submissionsFromObjects(objects, source = 'kobo') {
  const out = []; const bad = [];
  (objects || []).forEach((obj, index) => {
    const flat = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v == null || typeof v === 'object') continue;
      const leaf = String(k).split('/').pop();
      if (!(leaf in flat)) flat[leaf] = v;
    }
    const headers = Object.keys(flat);
    const values = headers.map((h) => flat[h]);
    const { submission: s, badDate } = rowToSubmission(headers, values, buildLookup(headers, [values]), source);
    if (badDate) { bad.push({ line: index + 1, ...badDate }); return; }
    // Kobo identifiers live on the raw object, not always flattened.
    s.externalId = obj._uuid || obj['meta/instanceID'] || s.externalId || (obj._id != null ? String(obj._id) : null);
    if (!s.periodMonth) {
      const fallback = parseCollectionDate(obj._submission_time);
      if (fallback.ok) s.periodMonth = fallback.month;
    }
    if (Object.keys(s.data).length > 0) out.push(s);
  });
  if (bad.length) throw invalidDatesError(bad, 'record');
  return out;
}

// Donne un identifiant stable (dé-duplication) aux soumissions sans _uuid,
// à partir du contenu — pour que ré-importer le même .sav soit idempotent.
function withStableIds(subs) {
  for (const s of subs) {
    if (!s.externalId) s.externalId = `sav:${crypto.createHash('sha1').update(JSON.stringify(s.data)).digest('hex').slice(0, 24)}`;
  }
  return subs;
}

// ---- Formats refusés ---------------------------------------------------------
const EXPECTED = 'Fournissez l\'export des données collectées : .xlsx, .csv, .sav ou .zip SPSS (Kobo/Ona).';
const XLSFORM = 'Ce classeur est la DÉFINITION d\'un formulaire (XLSForm : feuilles « survey » et « choices »), '
  + 'pas des données collectées. Importez-le avec le bouton « Importer un XLSForm » de la liste des fiches.';
const ZSAV = 'Fichier SPSS compressé (.zsav) : ce format n\'est pas pris en charge. Exportez en .sav ou .xlsx, puis réessayez.';

const REFUSALS = {
  empty: 'Fichier vide.',
  html: `Ce fichier est une page web (HTML), pas un export de données. ${EXPECTED}`,
  pdf: `Ce fichier est un document PDF, pas un tableau de données. ${EXPECTED}`,
  docx: `Ce fichier est un document Word (.docx), pas un tableau de données. ${EXPECTED}`,
  pptx: `Ce fichier est une présentation PowerPoint (.pptx), pas un tableau de données. ${EXPECTED}`,
  odf: `Ce fichier est un document OpenDocument, pas un tableau de données. ${EXPECTED}`,
  rtf: `Ce fichier est un document RTF, pas un tableau de données. ${EXPECTED}`,
  image: `Ce fichier est une image, pas un tableau de données. ${EXPECTED}`,
  zsav: ZSAV,
  ods: 'Classeur OpenDocument (.ods) : enregistrez-le au format .xlsx ou .csv, puis réessayez.',
  xlsb: 'Classeur Excel binaire (.xlsb) : enregistrez-le au format .xlsx ou .csv, puis réessayez.',
  json: `Fichier JSON : pour l'API Kobo ou Ona, utilisez l'import par lien. ${EXPECTED}`,
  xml: `Fichier XML : ce format n'est pas pris en charge. ${EXPECTED}`,
  gzip: 'Archive .gz : seules les archives .zip (export SPSS de Kobo) sont acceptées.',
  '7z': 'Archive 7-Zip (.7z) : seules les archives .zip (export SPSS de Kobo) sont acceptées.',
  rar: 'Archive RAR (.rar) : seules les archives .zip (export SPSS de Kobo) sont acceptées.',
  binary: `Fichier non reconnu (contenu binaire). ${EXPECTED}`,
};
const OLE_REFUSALS = {
  xls: 'Classeur Excel 97-2003 (.xls) : enregistrez-le au format .xlsx ou .csv, puis réessayez.',
  'xls-old': 'Classeur Excel 95 ou plus ancien : enregistrez-le au format .xlsx ou .csv, puis réessayez.',
  doc: `Ce fichier est un document Word 97-2003 (.doc), pas un tableau de données. ${EXPECTED}`,
  ppt: `Ce fichier est une présentation PowerPoint 97-2003 (.ppt), pas un tableau de données. ${EXPECTED}`,
  other: `Fichier Office 97-2003 non reconnu. ${EXPECTED}`,
};

function zipUnreadable(sniff) {
  if (sniff.error === 'too-many-entries') {
    return badRequest(`Archive refusée par sécurité : elle annonce ${sniff.declaredEntries} fichiers. Réexportez-la depuis Kobo ou Ona.`);
  }
  return badRequest('Archive .zip illisible ou corrompue. Téléchargez de nouveau l\'export, puis réessayez.');
}

/** .sav → soumissions + catalogue de variables (nom, libellé, étiquettes de valeurs). */
function fromSav(buf) {
  if (buf.length >= 4 && buf.toString('latin1', 0, 4) === '$FL3') throw badRequest(ZSAV);
  let parsed;
  try { parsed = parseSav(buf); }
  catch { throw badRequest('Fichier SPSS (.sav) illisible ou corrompu. Réexportez-le depuis Kobo ou Ona, puis réessayez.'); }
  if (!parsed.rows.length) throw badRequest('Aucune donnée dans le fichier .sav.');
  const submissions = withStableIds(submissionsFromObjects(parsed.rows, 'sav'));
  return { submissions, headers: parsed.variables.map((v) => v.name), variables: parsed.variables, source: 'sav' };
}

/** Zip SPSS de Kobo : on lit data.sav (ou le premier .sav), APRÈS la garde de taille. */
function fromSpssZip(buffer, sniff, limits) {
  if (!sniff.entries) throw zipUnreadable(sniff);
  const files = sniff.entries.filter((e) => !e.isDirectory);
  const entry = files.find((e) => /(^|\/)data\.sav$/i.test(e.name)) || files.find((e) => /\.sav$/i.test(e.name));
  if (!entry) {
    if (files.some((e) => /\.zsav$/i.test(e.name))) throw badRequest(ZSAV);
    throw badRequest('Archive .zip sans fichier SPSS (.sav) : l\'export « SPSS » de Kobo contient data.sav.');
  }
  assertZipEntries([entry], limits, { archiveBytes: buffer.length }); // 413 / 400 AVANT décompression
  let data;
  try { data = new AdmZip(buffer).getEntry(entry.name).getData(); }
  catch { throw zipUnreadable({}); }
  return fromSav(data);
}

async function fromXlsx(buffer, sniff, limits) {
  assertZipEntries(sniff.entries, limits, { archiveBytes: buffer.length }); // ExcelJS décompresse tout
  if (looksLikeXlsform(xlsxSheetNames(buffer))) throw badRequest(XLSFORM);
  let table;
  try { table = await parseXlsx(buffer); }
  catch { throw badRequest('Classeur Excel (.xlsx) illisible ou corrompu. Ouvrez-le dans Excel, enregistrez-le de nouveau, puis réessayez.'); }
  return tabular(table, 'xlsx');
}

function tabular({ headers, rows, lines }, source) {
  if (!headers.length) return { submissions: [], headers: [], variables: null, source };
  return { submissions: buildSubmissions(headers, rows, lines, source), headers, variables: null, source };
}

/**
 * Lit un fichier de soumissions, quel que soit son format, reconnu par son
 * contenu. Lève une AppError : 400 (format refusé, date illisible…) ou 413
 * (trop volumineux une fois décompressé). Ne touche jamais la base.
 * @param {Buffer} buffer
 * @param {{ zipLimits?: {maxBytes:number,maxRatio:number,ratioFloorBytes:number} }} [opts]
 * @returns {Promise<{ submissions: object[], headers: string[], variables: object[]|null, source: string }>}
 */
async function parseSubmissions(buffer, { zipLimits = DEFAULT_ZIP_LIMITS } = {}) {
  const sniff = sniffFile(buffer);
  switch (sniff.kind) {
    case 'text': return tabular(parseCsv(decodeText(buffer, sniff)), 'csv');
    case 'xlsx': return fromXlsx(buffer, sniff, zipLimits);
    case 'sav': return fromSav(buffer);
    case 'zip': return fromSpssZip(buffer, sniff, zipLimits);
    case 'ole': {
      const ole = inspectOle(buffer);
      if (ole.kind === 'xls' && looksLikeXlsform(ole.sheetNames)) throw badRequest(XLSFORM);
      throw badRequest(OLE_REFUSALS[ole.kind] || OLE_REFUSALS.other);
    }
    default: throw badRequest(REFUSALS[sniff.kind] || `Format non pris en charge (${sniff.label}). ${EXPECTED}`);
  }
}

module.exports = { parseSubmissions, submissionsFromObjects, parseCsv, buildLookup, MAP };
