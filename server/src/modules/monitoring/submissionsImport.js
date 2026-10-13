const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { MAP, DATE_KEYS, canonicalExternalId, OTHER_VALUES, OTHER_SUFFIXES, OTHER_EXTRA } = require('./memsMapping');
const { collectionMonth } = require('./collectionDate');
const { parseSav } = require('./savParser');
const { inspectOle } = require('./xlsReader');
const { looksLikeXlsform } = require('./xlsformImport');
const { sniffFile, decodeText, xlsxSheetNames } = require('../common/fileSniff');
const { assertZipEntries, zipLimitsFromEnv } = require('../common/zipGuard');
const { badRequest } = require('../../middleware/errors');
const { existingRows, rowValues, filledWidth, MAX_SHEET_COLUMNS } = require('../common/sheetRows');
const { loadWorkbook, isRefusal } = require('../common/xlsxGuard');

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
 * MOIS DE COLLECTE : deux dates sont lues, la date d'ENQUÊTE (la première
 * LISIBLE de SvyDate, today, start, end) et la date de RÉCEPTION par le serveur
 * (_submission_time) ; le mois retenu (period_month) et la date gardée
 * (submitted_at) suivent collectionDate.collectionMonth. Une candidate illisible
 * (« 15/01/2026 » dans SvyDate) ne masque pas une suivante lisible (end) : ces
 * fichiers s'importaient avant. Strictes comme avant : une date de réception
 * illisible, ou AUCUNE date d'enquête lisible sans date de réception, refusent le
 * fichier (400, ligne et colonne). Aucune date d'enquête lisible AVEC une date de
 * réception lisible ne refuse rien : le mois de réception est pris et la ligne
 * est comptée « date d'enquête illisible » dans la vérification et le compte rendu.
 * La vérification avant import et l'import appliquent les MÊMES colonnes choisies
 * dans « Mapping MEMS » (prepareImport) : mêmes mois, mêmes comptes.
 *
 * The « well-known column → typed field » alias table lives in `memsMapping.js`
 * (single source of truth, shared with the « Mapping MEMS » screen).
 */

const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const leafOf = (h) => String(h).split('/').pop();
// Colonne sous un groupe Kobo (« groupe/question »). Les colonnes système
// « formhub/… » (identifiant du FORMULAIRE) ne sont jamais lues comme des questions.
const isGroupPath = (h) => h != null && String(h).includes('/') && !/^formhub\//i.test(String(h));

// Forme d'un code de localité (pcode) : 2-3 lettres puis des chiffres (MG51507090).
const PCODE = /^[A-Za-z]{2,3}\d{1,14}[A-Za-z]?$/;
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
  // Export Excel « avec les groupes » : « Technical_module/…/Field_office ». Le nom de la
  // question (dernier segment) sert de second choix, après les noms complets.
  const byLeaf = new Map();
  headers.forEach((h, i) => {
    if (!isGroupPath(h)) return;
    const leaf = norm(leafOf(h));
    if (!byLeaf.has(leaf)) byLeaf.set(leaf, i);
  });
  const find = (name) => (byNorm.has(name) ? byNorm.get(name) : byLeaf.get(name));
  const sample = rows.slice(0, 50);
  const looksLikePcode = (col) => {
    const vals = sample.map((r) => r[col]).filter((v) => v != null && String(v).trim() !== '');
    return vals.length > 0 && vals.filter((v) => PCODE.test(String(v).trim())).length / vals.length >= 0.8;
  };
  // Colonnes « autre (préciser) » voisines d'une colonne de choix (DPName → DPName_Other).
  const othersOf = (i) => {
    const base = norm(headers[i]);
    return [...OTHER_SUFFIXES.map((suf) => byNorm.get(`${base}${suf}`)),
      ...(OTHER_EXTRA[norm(leafOf(headers[i]))] || []).map(find)].filter((j) => j !== undefined);
  };
  const picks = {};
  const cands = {};
  const others = {};
  for (const [field, aliases] of Object.entries(MAP)) {
    // Ordre des ALIAS d'abord (SvyDate → today → start → end), et pour chacun le nom complet
    // puis le nom de question sous un groupe. C'est l'ordre qu'obtiennent les clés renommées
    // par le catalogue (« grp/SvyDate » → « SvyDate ») : l'import (en-têtes bruts), la
    // vérification et la relecture (« Appliquer », r4 : clés enregistrées) choisissent la
    // MÊME colonne. Jamais de nom sous un groupe pour l'identifiant : « formhub/uuid » est
    // celui du FORMULAIRE, le même pour toutes les lignes.
    const ranked = aliases.flatMap((a) => [byNorm.get(norm(a)), field === 'external_id' ? undefined : byLeaf.get(norm(a))]);
    let candidates = [...new Set(ranked.filter((i) => i !== undefined))];
    if (!candidates.length) continue;
    // Niveau administratif sous plusieurs colonnes : celles qui portent des codes d'abord.
    if (ADMIN_KEYS.has(field) && candidates.length > 1) {
      candidates = [...candidates.filter(looksLikePcode), ...candidates.filter((i) => !looksLikePcode(i))];
    }
    picks[field] = candidates[0];
    cands[field] = candidates;
    others[field] = new Map(candidates.map((i) => [i, othersOf(i)]));
  }
  // Non énumérables : `picks[champ]` reste l'index de la colonne principale (compatibilité).
  Object.defineProperty(picks, 'candidates', { value: cands });
  Object.defineProperty(picks, 'others', { value: others });
  return picks;
}

/**
 * Espaces retirés autour d'une valeur : exactement ceux de String.prototype.trim(),
 * écrits pour une expression régulière PostgreSQL. La relecture SQL des champs typés
 * (monitoring.repository.reliftSubmissionsTx) nettoie ainsi comme l'import en JS.
 */
const TRIM_CLASS = '\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff';

/**
 * Clés des réponses ramenées aux noms du catalogue de la fiche (XLSForm ou
 * variables SPSS), pour qu'un formulaire importé en Excel « avec les groupes »
 * (« Technical_module/…/Field_office »), en SPSS ou par l'API porte les mêmes
 * clés — celles des indicateurs et du Mapping MEMS. Colonne d'une question à
 * choix multiples (« groupe/Q/1 ») : « Q.1 » si le catalogue la nomme ainsi
 * (SPSS), sinon « Q/1 ». Une clé que le catalogue ne connaît pas reste telle
 * quelle, et un renommage n'écrase jamais une clé déjà présente.
 * @param {string[]} catalogNames  noms des champs de la fiche
 * @returns {(data: object) => object}
 */
function groupPathRenamer(catalogNames) {
  const known = new Map();
  for (const n of catalogNames || []) {
    if (n != null && n !== '' && !known.has(String(n).toLowerCase())) known.set(String(n).toLowerCase(), String(n));
  }
  const has = (name) => known.has(name.toLowerCase());
  const get = (name) => known.get(name.toLowerCase());
  const cache = new Map();
  const target = (key) => {
    if (cache.has(key)) return cache.get(key);
    let out = null;
    if (isGroupPath(key) && !has(key)) {
      const seg = key.split('/');
      const n = seg.length;
      for (let i = 0; i < n && out == null; i += 1) {
        if (i > 0 && has(seg.slice(i).join('/'))) out = get(seg.slice(i).join('/'));
        else if (i === n - 2 && has(`${seg[i]}.${seg[n - 1]}`)) out = get(`${seg[i]}.${seg[n - 1]}`);
        else if (i === n - 2 && has(seg[i])) out = `${get(seg[i])}/${seg[n - 1]}`;
      }
      if (out === key) out = null;
    }
    cache.set(key, out);
    return out;
  };
  return (data) => {
    if (!known.size || !data) return data;
    let changed = false;
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      const t = target(k);
      if (t && !Object.prototype.hasOwnProperty.call(data, t) && !Object.prototype.hasOwnProperty.call(out, t)) {
        out[t] = v; changed = true;
      } else out[k] = v;
    }
    return changed ? out : data;
  };
}

/**
 * Valeur d'un champ typé pour une ligne : première colonne candidate non vide
 * (un même formulaire importé en Excel puis en SPSS n'a pas toujours les mêmes
 * colonnes) ; une réponse « autre » (999…) est remplacée par sa précision.
 */
function valueOf(picks, field, values) {
  const list = (picks.candidates && picks.candidates[field]) || (picks[field] != null ? [picks[field]] : []);
  for (const i of list) {
    const v = values[i];
    if (v == null || String(v).trim() === '') continue;
    if (OTHER_VALUES.has(String(v).trim().toLowerCase())) {
      const other = ((picks.others && picks.others[field] && picks.others[field].get(i)) || [])
        .map((j) => values[j]).find((x) => x != null && String(x).trim() !== '');
      if (other != null) return typeof other === 'string' ? other.trim() : other;
    }
    return typeof v === 'string' ? v.trim() : v;
  }
  return undefined;
}

/** Premier identifiant utilisable parmi les colonnes candidates (« uuid: » seul ne compte pas : on passe à la suivante, ex. _id). */
function externalIdOf(picks, values) {
  const list = (picks.candidates && picks.candidates.external_id) || (picks.external_id != null ? [picks.external_id] : []);
  for (const i of list) {
    const id = canonicalExternalId(values[i]);
    if (id) return id;
  }
  return null;
}

// Caractère nul (« _x0000_ » d'un .xlsx, \u0000 d'un JSON) retiré, demi-paire UTF-16 isolée (« _xD800_ »,
// \ud800) remplacée par « � » : PostgreSQL refuse les deux dans un texte ou un jsonb (toute l'importation
// échouerait, alors que la vérification l'avait acceptée).
// eslint-disable-next-line no-control-regex -- on retire justement ce caractère de contrôle
const NUL = /\u0000/g;
const noNul = (v) => (typeof v === 'string' ? (v.includes('\u0000') ? v.replace(NUL, '') : v).toWellFormed() : v);

/**
 * Champs de date d'une soumission d'après collectionMonth (non persistés : `dateSource`,
 * `dateIssue`, `dateLate`, `dateInputs` servent au compte rendu et à une colonne choisie
 * à la main).
 */
function dateFields(when, inputs) {
  return {
    periodMonth: when.ok ? when.month : null,
    submittedAt: when.ok ? when.date : null,
    uploadMonth: when.ok ? when.uploadMonth : null,
    dateSource: when.ok ? when.source : null,
    dateIssue: when.ok ? when.issue : null,
    dateLate: when.ok ? when.late === true : false,
    dateInputs: inputs,
  };
}

/**
 * Une ligne → une soumission. `badDate` est renseigné quand une date est
 * illisible et rend le mois de collecte indécidable (collectionMonth `ok: false`) :
 * la ligne n'est alors pas gardée et le fichier est refusé (400).
 * @returns {{ submission: object, badDate: {column:string,value:string}|null }}
 */
function rowToSubmission(rawHeaders, rawValues, picks, source) {
  const headers = rawHeaders.map(noNul);
  const values = rawValues.map(noNul);
  const data = {};
  headers.forEach((h, i) => {
    if (h == null || h === '') return;
    const v = values[i];
    if (v !== undefined && v !== null && v !== '') data[h] = v;
  });
  const at = (field) => valueOf(picks, field, values);
  // Date d'enquête : TOUTES les colonnes candidates, par priorité — la première lisible l'emporte.
  const surveyIdx = (picks.candidates && picks.candidates[DATE_KEYS.survey]) || [];
  const surveyVals = surveyIdx.map((i) => values[i]);
  const upload = at(DATE_KEYS.upload);
  const when = collectionMonth({ surveyDates: surveyVals, uploadDate: upload });
  const inputs = { survey: when.surveyIndex >= 0 ? surveyVals[when.surveyIndex] : undefined, upload };
  const submission = {
    externalId: externalIdOf(picks, values),
    ...dateFields(when, inputs),
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
  let badDate = null;
  if (!when.ok && when.field === 'survey') {
    const col = surveyIdx[when.surveyIndex];
    badDate = { column: String(headers[col]), value: String(values[col]).trim() };
  } else if (!when.ok) {
    const field = DATE_KEYS.upload;
    const col = ((picks.candidates && picks.candidates[field]) || []).find((i) => values[i] != null && String(values[i]).trim() !== '');
    badDate = { column: String(headers[col ?? picks[field]]), value: String(at(field)) };
  }
  return { submission, badDate };
}

/**
 * Colonnes de date d'une fiche, dans l'ordre de priorité de l'import (buildLookup : ordre des
 * alias, et pour chacun le nom complet puis le nom de question sous un groupe — clés brutes
 * ou renommées par le catalogue, la même colonne). `forcedSurvey` : `undefined` = automatique ;
 * '' = « aucune » (mois de réception seul) ; sinon la colonne choisie dans « Mapping MEMS »
 * (lue par overrideColumns : variantes de casse, nom renommé par le catalogue).
 * @param {string[]} keys  clés des réponses (data) de la fiche
 * @param {string} [forcedSurvey]
 * @param {string[]} [catalogNames]  noms des champs de la fiche
 * @returns {{ surveyCols: string[], uploadCols: string[] }}
 */
function collectionColumns(keys, forcedSurvey, catalogNames = []) {
  const list = (keys || []).filter((k) => k != null && k !== '');
  const picks = buildLookup(list, []);
  const cols = (field) => ((picks.candidates && picks.candidates[field]) || []).map((i) => list[i]);
  let surveyCols = cols(DATE_KEYS.survey);
  if (forcedSurvey !== undefined) surveyCols = overrideColumns(forcedSurvey, list, catalogNames);
  return { surveyCols, uploadCols: cols(DATE_KEYS.upload) };
}

/**
 * Mois de collecte d'une soumission recalculé avec une date d'enquête choisie à la main
 * (`survey` : valeur brute, ou valeurs candidates par priorité — la colonne choisie puis
 * ses variantes de casse ; `undefined` ou [] = aucune) ; la date de réception lue à
 * l'import est gardée. Aucune valeur lisible et pas de réception : la soumission reste
 * telle qu'importée (lecture automatique déjà vérifiée), comptée « date d'enquête illisible ».
 * @returns {boolean} vrai si la date d'enquête choisie était illisible
 */
function applySurveyDate(s, survey) {
  const surveyDates = Array.isArray(survey) ? survey : [survey];
  const upload = s.dateInputs ? s.dateInputs.upload : undefined;
  const when = collectionMonth({ surveyDates, uploadDate: upload });
  if (!when.ok) { s.dateIssue = 'survey_unreadable'; return true; }
  const inputs = { survey: when.surveyIndex >= 0 ? surveyDates[when.surveyIndex] : undefined, upload };
  if (!when.month && s.periodMonth) return false; // aucune date relue : on garde celle de l'import
  Object.assign(s, dateFields(when, inputs));
  return when.issue === 'survey_unreadable';
}

/**
 * Comptes « mois de collecte » d'un lot de soumissions (vérification avant import et
 * compte rendu) : mois tiré de l'enquête ou de la réception, mois différent du mois de
 * réception (ce qui change par rapport à l'ancienne règle), pourquoi la réception a
 * été prise (date d'enquête illisible, de plus de 2 ans avant l'envoi, postérieure à
 * l'envoi, colonne de date choisie dans « Mapping MEMS » absente du fichier) et, pour
 * information, les envois tardifs (plus de 92 jours après l'enquête, rangés au mois de
 * l'enquête).
 */
function dateSummary(submissions) {
  const out = {
    fromSurvey: 0, fromUpload: 0, monthDiffers: 0, surveyUnreadable: 0, surveyTooOld: 0, surveyAfterUpload: 0,
    surveyColumnMissing: 0, lateUpload: 0,
  };
  for (const s of submissions || []) {
    if (s.dateSource === 'survey') out.fromSurvey += 1;
    else if (s.dateSource === 'upload') out.fromUpload += 1;
    if (s.dateLate) out.lateUpload += 1;
    if (s.periodMonth && s.uploadMonth && s.periodMonth !== s.uploadMonth) out.monthDiffers += 1;
    if (s.dateIssue === 'survey_unreadable') out.surveyUnreadable += 1;
    else if (s.dateIssue === 'survey_too_old') out.surveyTooOld += 1;
    else if (s.dateIssue === 'survey_after_upload') out.surveyAfterUpload += 1;
    else if (s.dateIssue === 'survey_column_missing') out.surveyColumnMissing += 1;
  }
  return out;
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
async function parseXlsx(buffer, zipLimits) {
  const wb = await loadWorkbook(buffer, { zipLimits });
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [], lines: [] };
  // En-tête : jusqu'à sa dernière colonne non vide (cellules existantes seulement).
  const head = ws.findRow(1);
  const headers = Array.from(rowValues(head, filledWidth(head, MAX_SHEET_COLUMNS).width, cellText), (h) => h ?? '');
  const rows = []; const lines = [];
  // Seules les lignes et cellules qui EXISTENT sont lues, dans la largeur de l'en-tête : une
  // cellule isolée tout en bas ou tout à droite ne fait ni créer ni parcourir ce qui la précède.
  for (const { row, r } of existingRows(ws, 2)) {
    const vals = []; let any = false;
    const width = Math.min(headers.length, row.cellCount);
    for (let col = 1; col <= width; col += 1) {
      const cell = row.findCell(col);
      if (!cell) continue;
      const v = cellText(cell);
      vals[col - 1] = v;
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
    s.externalId = canonicalExternalId(noNul(obj._uuid || obj['meta/instanceID'])) || s.externalId || (obj._id != null ? noNul(String(obj._id)) : null);
    if (!s.periodMonth) {
      const fallback = collectionMonth({ uploadDate: obj._submission_time });
      if (fallback.ok && fallback.month) Object.assign(s, dateFields(fallback, { survey: undefined, upload: obj._submission_time }));
    }
    if (Object.keys(s.data).length > 0) out.push(s);
  });
  if (bad.length) throw invalidDatesError(bad, 'record');
  return out;
}

// Champs typés montrés à l'utilisateur avant un import (vérification).
const ANALYZED_FIELDS = ['external_id', 'survey_date', 'submitted_at', 'field_office', 'admin1', 'admin2', 'admin3', 'admin4', 'site', 'partner', 'agent'];

// Dimension « Mapping MEMS » choisie à la main → propriété de la soumission (valeurs recopiées).
const OVERRIDE_PROP = { field_office: 'fieldOffice', admin1: 'admin1', admin2: 'admin2', admin3: 'admin3', admin4: 'admin4', site: 'site', partner: 'partner', agent: 'agent' };

/**
 * Valeurs d'une colonne choisie à la main, par priorité : le nom exact, puis ses variantes de
 * casse présentes dans les réponses (XLSForm ≠ export SPSS) — comme collectionColumns.
 */
function forcedValues(data, column, catalogNames = []) {
  if (!data || !column) return [];
  return overrideColumns(column, Object.keys(data), catalogNames)
    .filter((k) => Object.prototype.hasOwnProperty.call(data, k)).map((k) => data[k]);
}

/**
 * Colonnes à lire pour une colonne choisie à la main dans « Mapping MEMS », par priorité :
 * le nom choisi, puis — s'il désigne une question sous un groupe que le catalogue renomme
 * (« grp/SvyDate » → « SvyDate », comme l'import le fait des réponses) — son nom renommé ;
 * chacun suivi de ses variantes de casse parmi `keys` (XLSForm ≠ export SPSS). La MÊME
 * règle à l'import, à la vérification et à « Appliquer aux soumissions » : une colonne
 * choisie avant l'arrivée du catalogue reste lue après. Pur.
 * @param {string} column  colonne choisie
 * @param {string[]} keys  clés présentes (réponses, ou colonnes du fichier)
 * @param {string[]} [catalogNames]  noms des champs de la fiche
 * @returns {string[]}
 */
function overrideColumns(column, keys, catalogNames = []) {
  const col = String(column == null ? '' : column).trim();
  if (!col) return [];
  const renamed = Object.keys(groupPathRenamer(catalogNames)({ [col]: true }))[0];
  const out = [];
  for (const c of renamed && renamed !== col ? [col, renamed] : [col]) {
    if (!out.includes(c)) out.push(c);
    const lower = c.toLowerCase();
    for (const k of keys || []) if (k !== c && String(k).toLowerCase() === lower && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Colonnes choisies à la main dans « Mapping MEMS » appliquées à une soumission lue (pur ;
 * modifie `s`). Valeur recopiée : la première non vide, nettoyée comme à l'import (valueOf)
 * et à la relecture SQL ; colonne vide = « aucune » (valeur effacée). Date d'enquête choisie :
 * mois de collecte recalculé par la même règle (applySurveyDate) ; colonne choisie ABSENTE du
 * fichier (`missing`, voir missingOverrides) : la soumission rangée au mois de réception est
 * comptée « colonne absente » (dateIssue 'survey_column_missing'), jamais en silence.
 * @param {object} s  soumission (sortie de parseSubmissions)
 * @param {Array<{ dimension: string, columnName: string|null }>} overrides
 * @param {{ missing?: Map<string, string>, catalogNames?: string[] }} [opts]  dimensions dont la colonne
 *   choisie manque au fichier ; noms du catalogue (colonne choisie sous un groupe → nom renommé)
 */
function applyFieldOverrides(s, overrides, { missing, catalogNames = [] } = {}) {
  for (const o of overrides || []) {
    const col = (o.columnName || '').trim();
    const vals = col ? forcedValues(s.data, col, catalogNames) : [];
    if (o.dimension === DATE_KEYS.survey) {
      applySurveyDate(s, vals);
      if (missing && missing.has(o.dimension) && s.dateSource === 'upload' && !s.dateIssue) s.dateIssue = 'survey_column_missing';
      continue;
    }
    const prop = OVERRIDE_PROP[o.dimension];
    if (!prop) continue;
    const v = vals.map((x) => (x == null ? '' : String(x).trim())).find((x) => x !== '');
    s[prop] = v === undefined ? null : v;
  }
  return s;
}

/** Même identifiant Kobo deux fois : une seule soumission, la DERNIÈRE version (sans identifiant : toutes gardées). */
function uniqueByExternalId(submissions) {
  const unique = []; const at = new Map();
  for (const s of submissions || []) {
    if (s.externalId && at.has(s.externalId)) { unique[at.get(s.externalId)] = s; continue; }
    if (s.externalId) at.set(s.externalId, unique.length);
    unique.push(s);
  }
  return unique;
}

/**
 * Colonnes choisies dans « Mapping MEMS » ABSENTES d'un fichier : ni parmi ses colonnes
 * (casse ignorée, comme forcedValues), ni parmi ses colonnes ramenées aux noms du catalogue
 * (« grp/Bureau » → « Bureau », comme l'import). Une colonne vide (« aucune ») n'est jamais
 * absente : c'est un choix. Pur.
 * @param {Array<{ dimension: string, columnName: string|null }>} overrides
 * @param {string[]} headers  colonnes (ou variables SPSS) du fichier
 * @param {string[]} [catalogNames]  noms des champs de la fiche
 * @returns {Map<string, string>} dimension → colonne choisie absente
 */
function missingOverrides(overrides, headers, catalogNames = []) {
  const cols = (headers || []).filter((h) => h != null && h !== '').map(String);
  // Clés que l'import lira : colonnes du fichier ramenées aux noms du catalogue (groupPathRenamer).
  const read = Object.keys(groupPathRenamer(catalogNames)(Object.fromEntries(cols.map((h) => [h, true]))));
  const present = new Set(read.map((h) => h.toLowerCase()));
  const out = new Map();
  for (const o of overrides || []) {
    const col = (o.columnName || '').trim();
    if (col && !overrideColumns(col, read, catalogNames).some((c) => present.has(c.toLowerCase()))) out.set(o.dimension, col);
  }
  return out;
}

/** Colonnes d'un lot lu sans en-têtes (API, lien JSON) : toutes les clés de ses réponses. */
function keysOfSubmissions(list) {
  const keys = new Set();
  for (const s of list || []) for (const k of Object.keys(s.data || {})) keys.add(k);
  return [...keys];
}

/**
 * Soumissions lues → ce que l'import écrira, pour l'import ET pour la vérification avant
 * import (mêmes mois, mêmes comptes) : doublons du fichier fondus (dernière version), clés
 * des réponses ramenées aux noms du catalogue de la fiche (groupPathRenamer), puis colonnes
 * choisies dans « Mapping MEMS » appliquées (applyFieldOverrides) — celles absentes du
 * fichier (`headers`, ou à défaut les clés des réponses) sont signalées (`missing`). Pur ;
 * modifie les soumissions retenues (comme l'import l'a toujours fait).
 * @param {object[]} submissions  sortie de parseSubmissions
 * @param {{ catalogNames?: string[], overrides?: Array<{dimension:string,columnName:string|null}>, headers?: string[] }} ctx
 * @returns {{ unique: object[], duplicates: number, missing: Map<string, string> }}
 */
function prepareImport(submissions, { catalogNames = [], overrides = [], headers } = {}) {
  const list = submissions || [];
  const unique = uniqueByExternalId(list);
  const canonical = groupPathRenamer(catalogNames);
  const missing = overrides.length ? missingOverrides(overrides, headers || keysOfSubmissions(unique), catalogNames) : new Map();
  for (const s of unique) {
    s.data = canonical(s.data || {});
    if (overrides.length) applyFieldOverrides(s, overrides, { missing, catalogNames });
  }
  return { unique, duplicates: list.length - unique.length, missing };
}

/**
 * Ce que contient un fichier lu, avant de l'importer (rien n'est écrit) :
 * nombre de soumissions, colonne reconnue pour chaque champ MEMS (celle choisie dans
 * « Mapping MEMS » quand il y en a une : `manual` — reconnue seulement si le fichier la
 * contient, sinon `missing[champ]` = la colonne choisie, absente), mois couverts, première et dernière
 * date, doublons dans le fichier, lignes sans identifiant (un réimport les compterait
 * deux fois). Mois, dates et comptes « mois de collecte » portent sur ce que l'import
 * écrira (`unique`, sortie de prepareImport) : les mêmes que son compte rendu. Logique pure.
 * @param {object[]} submissions  sortie de parseSubmissions
 * @param {string[]} headers       colonnes (ou variables SPSS) du fichier
 * @param {{ unique?: object[], overrides?: Array<{dimension:string,columnName:string|null}>,
 *   missing?: Map<string,string>, catalogNames?: string[] }} [opts]  `missing` : sortie de prepareImport
 */
function analyzeSubmissions(submissions, headers = [], { unique, overrides = [], missing, catalogNames = [] } = {}) {
  const list = submissions || [];
  const kept = unique || uniqueByExternalId(list);
  const cols = (headers || []).filter((h) => h != null && h !== '');
  const picks = buildLookup(cols, list.slice(0, 50).map((x) => cols.map((h) => (x.data || {})[h])));
  const recognized = Object.fromEntries(ANALYZED_FIELDS.map((f) => [f, picks[f] != null ? cols[picks[f]] : null]));
  const manual = [];
  // Colonne choisie absente du fichier : jamais montrée « reconnue » (l'import ne la lira pas).
  const absent = missing || missingOverrides(overrides, cols, catalogNames);
  const missingCols = {};
  for (const o of overrides) {
    if (!ANALYZED_FIELDS.includes(o.dimension)) continue;
    const col = (o.columnName || '').trim();
    recognized[o.dimension] = col && !absent.has(o.dimension) ? col : null;
    if (col && absent.has(o.dimension)) missingCols[o.dimension] = col;
    manual.push(o.dimension);
  }
  const months = new Map();
  const seen = new Set();
  let from = null; let to = null; let duplicatesInFile = 0; let withoutId = 0; let withoutDate = 0;
  for (const x of list) {
    if (!x.externalId) withoutId += 1;
    else if (seen.has(x.externalId)) duplicatesInFile += 1;
    else seen.add(x.externalId);
  }
  for (const x of kept) {
    if (x.periodMonth) months.set(x.periodMonth, (months.get(x.periodMonth) || 0) + 1); else withoutDate += 1;
    if (x.submittedAt) {
      const iso = new Date(x.submittedAt).toISOString().slice(0, 10);
      if (!from || iso < from) from = iso;
      if (!to || iso > to) to = iso;
    }
  }
  return {
    count: list.length,
    recognized,
    manual,
    missing: missingCols,
    months: [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, n]) => ({ month, n })),
    from, to, duplicatesInFile, withoutId, withoutDate,
    dates: dateSummary(kept),
    ids: [...seen],
  };
}

/**
 * Vérification avant import d'un fichier lu (pur, rien n'est écrit) : la MÊME préparation que
 * l'import (prepareImport, avec les colonnes choisies dans « Mapping MEMS » et le catalogue de
 * la fiche), puis analyzeSubmissions — mois et comptes identiques à ce que l'import écrira.
 * La préparation porte sur des COPIES : les soumissions lues restent telles quelles (colonnes
 * reconnues lues sur les en-têtes du fichier, pas sur les clés renommées).
 * @param {object[]} submissions  sortie de parseSubmissions
 * @param {string[]} headers       colonnes (ou variables SPSS) du fichier
 * @param {{ catalogNames?: string[], overrides?: Array<{dimension:string,columnName:string|null}> }} [ctx]
 */
function previewImport(submissions, headers = [], ctx = {}) {
  const list = submissions || [];
  const { unique, missing } = prepareImport(list.map((s) => ({ ...s })), { ...ctx, headers });
  return analyzeSubmissions(list, headers, { unique, overrides: ctx.overrides || [], missing });
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
  try { table = await parseXlsx(buffer, limits); }
  catch (err) { if (isRefusal(err)) throw err; throw badRequest('Classeur Excel (.xlsx) illisible ou corrompu. Ouvrez-le dans Excel, enregistrez-le de nouveau, puis réessayez.'); }
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
async function parseSubmissions(buffer, { zipLimits = zipLimitsFromEnv(process.env) } = {}) {
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

module.exports = {
  parseSubmissions, submissionsFromObjects, parseCsv, buildLookup, valueOf, groupPathRenamer, overrideColumns, analyzeSubmissions, previewImport,
  collectionColumns, applySurveyDate, applyFieldOverrides, prepareImport, missingOverrides, uniqueByExternalId, dateSummary, TRIM_CLASS, MAP,
};
