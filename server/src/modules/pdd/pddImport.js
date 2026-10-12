const ExcelJS = require('exceljs');
const { loadWorkbook } = require('../common/xlsxGuard');

/**
 * Parseur du tableau PDD (Plan de Distribution d'urgence) : feuille « PDD base »
 * du modèle MEMS, ou feuille du classeur réel (ex. « Oct_Nov », tableau Excel
 * « Table1 »). En-tête repéré dans les 12 premières lignes (« Mois » en A et
 * « Commune » en P), données juste en dessous. Lit les RÉSULTATS des formules
 * (bénéficiaires, tonnages). Aucune I/O : l'insertion est faite par le repo.
 *
 * Fiabilité :
 *  • seules les lignes qui EXISTENT sont parcourues (`eachRow` + `findCell`) :
 *    aucune ligne ni cellule n'est créée en mémoire. Une valeur isolée en ligne
 *    1 048 000 coûte une ligne, pas un million (avant : 42 s et 8,4 Go) ;
 *    jamais de `actualRowCount` / `columnCount` (parcours complet de la feuille) ;
 *  • au-delà de MAX_DATA_ROWS lignes non vides, l'import est refusé (400) ;
 *  • une ligne écartée est TOUJOURS listée avec son motif (`skippedRows`), y
 *    compris une ligne écrite SOUS le tableau Excel structuré ;
 *  • une erreur Excel (#REF!, #N/A, #VALUE!, #DIV/0!…) n'est jamais lue comme 0,
 *    une formule sans résultat enregistré non plus : la ligne est écartée ;
 *  • mois, année, modalité et nombres sont contrôlés — rien n'est deviné en
 *    silence (pas d'année courante par défaut, « 1,250 » / « 1.250 » refusés
 *    car ambigus) ;
 *  • chaque motif porte un code et ses paramètres (`{ code, params, template }`)
 *    en plus du texte français : l'interface le traduit (tr).
 */

// ---- Disposition des colonnes (positions fixes, n° de colonne Excel) ------
const COL = {
  month: 1, year: 2, wbs: 3, program: 4, activity: 7, antenne: 10, sousBureau: 11, partner: 12, corridor: 13,
  region: 14, district: 15, commune: 16, beneficiaries: 20, households: 21, modality: 22, totalFood: 41, cashUsd: 43,
};
// Colonnes denrées (n° → libellé), tonnage en MT.
const COMMODITIES = [[27, 'Riz'], [28, 'Mais concassé'], [29, 'Mais en grain'], [30, 'Sorgho'], [31, 'LS'], [32, 'Huile'], [33, 'MNP'], [34, 'P Sup'], [35, 'CSB+'], [36, 'CSB++'], [37, 'P Doz'], [38, 'LNS-sq'], [39, 'Dattes'], [40, 'HEB']];

const TEXT_COLS = [COL.month, COL.year, COL.wbs, COL.program, COL.activity, COL.antenne, COL.sousBureau, COL.partner,
  COL.corridor, COL.region, COL.district, COL.commune, COL.modality];
const NUMBER_COLS = [COL.beneficiaries, COL.households, ...COMMODITIES.map(([c]) => c), COL.totalFood, COL.cashUsd];
const READ_COLS = [...TEXT_COLS, ...NUMBER_COLS];
const IDENTITY_COLS = [COL.month, COL.activity, COL.program, COL.district, COL.commune];
const COL_LABEL = {
  [COL.month]: 'Mois', [COL.year]: 'Année', [COL.wbs]: 'WBS', [COL.program]: 'Programme', [COL.activity]: 'Activité',
  [COL.antenne]: 'Antenne', [COL.sousBureau]: 'Sous-bureau', [COL.partner]: 'Partenaire', [COL.corridor]: 'Corridor',
  [COL.region]: 'Région', [COL.district]: 'District', [COL.commune]: 'Commune', [COL.beneficiaries]: 'Bénéficiaires',
  [COL.households]: 'Ménages', [COL.modality]: 'Modalité', [COL.totalFood]: 'Total vivres', [COL.cashUsd]: 'Cash USD',
  ...Object.fromEntries(COMMODITIES),
};
const MAX_VALUE = 1e9; // garde-fou : au-delà, valeur manifestement erronée (et hors des colonnes SQL)
const HEADER_SCAN_ROWS = 12;
const MAX_LISTED = 500; // lignes ignorées / avertissements renvoyés (le total reste exact)
const MAX_DATA_ROWS = 20000; // lignes non vides sous l'en-tête ; au-delà : refus explicite (400)
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

// ---- Messages : code → modèle français (clé de traduction côté interface) --
// Les paramètres sont des chaînes, sauf les compteurs et n° de ligne (nombres).
// `label` est un libellé de colonne français, traduit lui aussi par l'interface.
const MESSAGES = {
  EXCEL_ERROR: 'erreur Excel {error} en colonne {col} ({label})',
  FORMULA_NOT_CALCULATED: 'formule non calculée en colonne {col} ({label}) : ouvrez et enregistrez le fichier dans Excel',
  NOT_A_NUMBER: 'valeur non numérique « {value} » en colonne {col} ({label})',
  AMBIGUOUS_NUMBER: 'nombre ambigu « {value} » en colonne {col} ({label}) : séparateur de milliers ou décimal ? Saisissez un nombre Excel',
  NEGATIVE_VALUE: 'valeur négative ({value}) en colonne {col} ({label})',
  VALUE_TOO_LARGE: 'valeur hors limites ({value}) en colonne {col} ({label})',
  MONTH_MISSING: 'mois absent',
  MONTH_UNKNOWN: 'mois inconnu « {value} »',
  MONTH_OUT_OF_RANGE: 'mois invalide « {value} » (date hors des années 2000 à 2100)',
  YEAR_MISSING: 'année absente',
  YEAR_INVALID: 'année invalide « {value} » (attendu : 4 chiffres entre 2000 et 2100, ex. 2026)',
  YEAR_MISMATCH: 'année incohérente ({year} en colonne {col} ({label}), {monthYear} dans le mois)',
  ACTIVITY_MISSING: 'activité absente (colonne {col} ou {col2})',
  ZONE_MISSING: 'zone absente (district et commune vides)',
  MODALITY_UNKNOWN: 'modalité inconnue « {value} » (attendu : {expected} — ou Vivres, Cash)',
  OUTSIDE_TABLE: 'ligne hors du tableau Excel « {table} » : étendez le tableau',
  // Avertissements (non bloquants)
  ERROR_ROWS_WITHOUT_IDENTITY: '{n} ligne(s) sans mois, activité ni zone portent des erreurs Excel ({errors}) : non importées (lignes {from} à {to})',
  // Disposition des colonnes
  LAYOUT_HEADER: 'colonne {col} : en-tête « {found} » au lieu de « {label} »',
  LAYOUT_HEADER_EMPTY: 'colonne {col} : en-tête vide au lieu de « {label} »',
  LAYOUT_CASH_CURRENCY: 'colonne {col} : « {found} » est un montant en ariary, cette colonne doit contenir le cash en USD',
  // Refus de l'import entier (route) — rien n'est écrit
  IMPORT_EMPTY_FILE: 'Fichier vide.',
  IMPORT_NOT_XLSX: 'Ce fichier n\'est pas un classeur Excel .xlsx (format reconnu : {format}) : enregistrez le plan de distribution au format .xlsx puis réessayez.',
  IMPORT_UNREADABLE: 'Fichier illisible : fournissez un .xlsx du plan de distribution.',
  IMPORT_NO_SHEET: 'Aucun tableau PDD détecté : il faut une ligne d\'en-tête avec « Mois » en colonne A et « Commune » en colonne P (feuille « PDD base » du modèle).',
  IMPORT_LAYOUT: 'La feuille « {sheet} » n\'a pas la disposition attendue (colonne insérée ou supprimée ?) : rien n\'a été importé.',
  IMPORT_TOO_MANY_ROWS: 'La feuille « {sheet} » compte {count} lignes remplies sous l\'en-tête, au-delà du plafond de {limit} : découpez le fichier (par exemple par trimestre) puis importez chaque partie. Rien n\'a été importé.',
  IMPORT_NO_VALID_ROWS: 'Aucune ligne exploitable (mois, année, activité et zone requis) : {skipped} ligne(s) ignorée(s), rien n\'a été importé.',
  IMPORT_PARTIAL_REFUSED: '{blocking} ligne(s) ignorée(s) concernent un mois que cet import remplacerait, ou un mois illisible : rien n\'a été importé, pour ne pas effacer de distributions. Corrigez ces lignes et réimportez, ou cochez « Importer quand même ».',
};

/** « {x} » → params.x (texte français ; nombres au format français, comme l'interface). */
function render(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (m, k) => {
    const v = params[k];
    if (v == null) return m;
    return typeof v === 'number' ? v.toLocaleString('fr-FR') : String(v);
  });
}
/** Motif structuré : code + paramètres + modèle (pour tr) + texte français. */
function issue(code, params = {}) {
  return { code, params, template: MESSAGES[code], message: render(MESSAGES[code], params) };
}
const sentence = (s) => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;

/** Lettre de colonne Excel (1 → A, 27 → AA). */
function colLetter(n) {
  let s = ''; let x = n;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}
const colParams = (c) => ({ col: colLetter(c), label: COL_LABEL[c] || '?' });
/** Minuscules sans accents ni espaces superflus. */
const fold = (v) => String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// ---- Lecture d'une cellule ----------------------------------------------
const EXCEL_ERRORS = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#GETTING_DATA', '#SPILL!', '#CALC!', '#FIELD!', '#BLOCKED!', '#CONNECT!', '#BUSY!', '#UNKNOWN!']);
const isError = (v) => v != null && typeof v === 'object' && !(v instanceof Date) && 'error' in v;
/** Formule enregistrée SANS son résultat (fichier jamais recalculé par Excel). */
const NOT_CALCULATED = Object.freeze({ notCalculated: true });
const isNotCalculated = (v) => v === NOT_CALCULATED;
/** Valeur réellement saisie ou calculée (ni vide, ni erreur, ni formule non calculée). */
const hasValue = (v) => v != null && !isError(v) && !isNotCalculated(v);

/**
 * Valeur exploitable d'une valeur de cellule exceljs : résultat des formules,
 * texte riche aplati, lien → texte. Une erreur Excel (typée, en résultat de
 * formule, ou saisie comme texte « #N/A ») devient `{ error: '#N/A' }` — jamais
 * `null` ni 0. Une formule sans résultat enregistré devient NOT_CALCULATED.
 */
function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.error != null) return { error: String(v.error) };
    if ('formula' in v || 'sharedFormula' in v) return v.result === undefined ? NOT_CALCULATED : cellValue(v.result);
    if (v.richText) return cellValue(v.richText.map((x) => x.text).join(''));
    if (v.text != null) return cellValue(v.text);
    return null;
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (EXCEL_ERRORS.has(t.toUpperCase())) return { error: t.toUpperCase() };
    return t === '' ? null : t;
  }
  return v;
}

/** Texte d'une valeur (déjà passée par cellValue) ; '' si vide, erreur ou non calculée. */
function text(v) {
  if (!hasValue(v)) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/**
 * « 1,250 » : milliers à l'anglaise (1 250) ou décimales à la française (1,25) ?
 * « 1.250 » : milliers à la française / malgache (1 250, cf. « 1.250.000 Ar »)
 * ou décimales à l'anglaise (1,25) ? Un seul séparateur (virgule OU point)
 * suivi d'exactement 3 chiffres, partie entière de 1 à 3 chiffres sans zéro
 * initial : on ne devine pas (« 1.250 » bénéficiaires lu 1,25 → 1 personne).
 */
const isAmbiguousNumber = (t) => /^[-+]?[1-9]\d{0,2}[,.]\d{3}$/.test(t);

/** Nombre d'une valeur : null si vide, NaN si non numérique ou ambigu. Accepte « 1 250,5 ». */
function toNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN; // date, booléen, erreur, formule non calculée
  const t = v.replace(/[\s\u00a0\u202f]/g, '');
  if (t === '' || t === '-' || t === '—') return null;
  if (t.includes(',') && t.includes('.')) return NaN; // séparateurs mêlés : ne pas deviner
  if (isAmbiguousNumber(t)) return NaN;
  const n = t.replace(',', '.');
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(n) ? Number(n) : NaN;
}

// ---- Listes contrôlées ----------------------------------------------------
const MONTHS = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  // Abréviations françaises et anglaises SANS ambiguïté (« jui » = juin ou juillet ? refusé).
  janv: 1, jan: 1, fev: 2, fevr: 2, feb: 2, mar: 3, avr: 4, apr: 4, jun: 6, juil: 7, jul: 7, aug: 8,
  sept: 9, sep: 9, oct: 10, nov: 11, dec: 12,
};
const yearOk = (y) => Number.isInteger(y) && y >= YEAR_MIN && y <= YEAR_MAX;
const isoDay = (d) => d.toISOString().slice(0, 10);

/**
 * Mois d'une cellule : nom français ou anglais, complet ou abrégé (accents,
 * casse et point final indifférents : « Fevrier », « févr. », « Sept »),
 * numéro 1–12, date Excel (2000–2100), ou « Octobre 2025 ».
 * → { month, year? } | { missing: true } | { unknown: 'texte lu' } | { invalid: 'date' }
 */
function parseMonth(v) {
  if (v == null || v === '') return { missing: true };
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { unknown: String(v) };
    return yearOk(v.getUTCFullYear()) ? { month: v.getUTCMonth() + 1, year: v.getUTCFullYear() } : { invalid: isoDay(v) };
  }
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 12 ? { month: v } : { unknown: String(v) };
  const f = fold(v);
  if (/^\d{1,2}$/.test(f)) { const m = Number(f); return m >= 1 && m <= 12 ? { month: m } : { unknown: String(v) }; }
  const m = /^([a-z]+)\.?(?:[\s\-_/]+(\d{4}))?$/.exec(f);
  if (m && MONTHS[m[1]]) {
    if (!m[2]) return { month: MONTHS[m[1]] };
    return yearOk(Number(m[2])) ? { month: MONTHS[m[1]], year: Number(m[2]) } : { invalid: String(v).trim() };
  }
  return { unknown: String(v).trim() };
}

/** Année : entier 2000–2100 (nombre, texte « 2026 » ou date). → { year } | { missing } | { invalid } */
function parseYear(v) {
  if (v == null || v === '') return { missing: true };
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { invalid: String(v) };
    return yearOk(v.getUTCFullYear()) ? { year: v.getUTCFullYear() } : { invalid: isoDay(v) };
  }
  const n = toNumber(v);
  if (n == null) return { missing: true };
  return yearOk(n) ? { year: n } : { invalid: String(v).trim() };
}

/**
 * Modalités canoniques (valeur enregistrée) et synonymes acceptés à l'import.
 * Le classeur réel utilise « Inkind » et « CBT » ; l'ancien modèle MEMS
 * proposait « Vivres », « Cash » et « Mixte ». Comparaison sans casse, accents,
 * espaces ni ponctuation (« In-kind » = « inkind »). La base n'accepte que les
 * trois valeurs canoniques (migration 057, qui reprend ces mêmes synonymes).
 *   Inkind — distribution en nature (vivres) ;
 *   CBT    — transfert monétaire (cash-based transfer) ;
 *   Mixte  — vivres + transfert monétaire.
 */
const MODALITIES = {
  Inkind: ['inkind', 'vivres', 'vivre', 'food', 'ennature', 'nature', 'denrees'],
  CBT: ['cbt', 'cash', 'cashbasedtransfer', 'cashbasedtransfers', 'transfertmonetaire', 'transfertsmonetaires', 'argent', 'especes'],
  Mixte: ['mixte', 'mixed', 'mix', 'inkindcbt', 'cbtinkind', 'vivrescash', 'cashvivres', 'vivresetcash', 'cashetvivres', 'foodcash', 'cashfood'],
};
const MODALITY_BY_KEY = Object.fromEntries(Object.entries(MODALITIES).flatMap(([canon, keys]) => keys.map((k) => [k, canon])));
const MODALITY_VALUES = Object.keys(MODALITIES);
/** Clé de comparaison d'une modalité (même règle que la migration 057). */
const modalityKey = (raw) => fold(raw).replace(/[^a-z0-9]/g, '');

/** → { value: 'Inkind'|'CBT'|'Mixte'|null } | { unknown: 'texte lu' } */
function canonicalModality(v) {
  const raw = text(v);
  if (!raw) return { value: null };
  const canon = MODALITY_BY_KEY[modalityKey(raw)];
  return canon ? { value: canon } : { unknown: raw };
}

const hazardOf = (activity) => (/cyclone/i.test(activity) ? 'cyclone' : (/drought|s[ée]ch/i.test(activity) ? 'drought' : 'autre'));
const r3 = (n) => Math.round(n * 1000) / 1000;
const monthStart = (year, month) => `${year}-${String(month).padStart(2, '0')}-01`;

/** Mois (1er du mois) de la ligne quand mois ET année sont sûrs ; null sinon. */
function rowMonth(pm, py) {
  if (!pm.month || py.invalid) return null;
  if (py.year && pm.year && py.year !== pm.year) return null;
  const year = py.year || pm.year;
  return year ? monthStart(year, pm.month) : null;
}

/** Valeurs lues d'une ligne + nombres contrôlés + motifs liés aux cellules (pur). */
function readCells(at) {
  const v = {};
  for (const c of READ_COLS) v[c] = cellValue(at(c));
  const issues = [];
  const errors = [];
  for (const c of READ_COLS) {
    if (isError(v[c])) { errors.push(v[c].error); issues.push(issue('EXCEL_ERROR', { error: v[c].error, ...colParams(c) })); }
    else if (isNotCalculated(v[c])) issues.push(issue('FORMULA_NOT_CALCULATED', colParams(c)));
  }
  const nums = {};
  let hasFigure = false;
  for (const c of NUMBER_COLS) {
    if (!hasValue(v[c])) { nums[c] = 0; continue; }
    const n = toNumber(v[c]);
    if (Number.isNaN(n)) {
      const shown = text(v[c]) || String(v[c]);
      issues.push(issue(isAmbiguousNumber(shown.replace(/[\s\u00a0\u202f]/g, '')) ? 'AMBIGUOUS_NUMBER' : 'NOT_A_NUMBER', { value: shown, ...colParams(c) }));
      hasFigure = true; // une saisie, même illisible, n'est pas une ligne vide
      continue;
    }
    if (n != null && n < 0) issues.push(issue('NEGATIVE_VALUE', { value: String(n), ...colParams(c) }));
    else if (n != null && n > MAX_VALUE) issues.push(issue('VALUE_TOO_LARGE', { value: String(n), ...colParams(c) }));
    nums[c] = n || 0;
    if (n) hasFigure = true;
  }
  const identity = IDENTITY_COLS.some((c) => hasValue(v[c]));
  return { v, issues, errors, nums, hasFigure, identity };
}

/**
 * Lit UNE ligne du tableau. `at(col)` renvoie la valeur exceljs brute de la
 * colonne. Pur : aucune I/O.
 * → { empty: true, errors? } (ligne vide : ni importée ni « ignorée » ; `errors`
 *     = erreurs Excel d'une ligne sans mois, activité, zone ni chiffre)
 *   | { skip: { line, month, message, issues } } (ligne écartée ; `month` =
 *     1er du mois si mois ET année sont sûrs, sinon null)
 *   | { row } (ligne de distribution prête à insérer)
 */
function parsePddRow(at, line) {
  const { v, issues, errors, nums, hasFigure, identity } = readCells(at);
  // Ni mois, ni activité, ni zone, ni chiffre : ligne vide (ex. lignes de saisie
  // du modèle, formules recopiées vers le bas). Ses erreurs Excel éventuelles
  // sont remontées pour un avertissement groupé.
  if (!identity && !hasFigure) return errors.length ? { empty: true, errors } : { empty: true };

  // Une cellule en erreur ou non calculée est déjà signalée : pas de second motif.
  const monthCell = v[COL.month];
  const pm = hasValue(monthCell) ? parseMonth(monthCell) : {};
  if (monthCell == null) issues.push(issue('MONTH_MISSING'));
  else if (pm.unknown) issues.push(issue('MONTH_UNKNOWN', { value: pm.unknown }));
  else if (pm.invalid) issues.push(issue('MONTH_OUT_OF_RANGE', { value: pm.invalid }));

  const yearCell = v[COL.year];
  const py = hasValue(yearCell) ? parseYear(yearCell) : {};
  if (py.invalid) issues.push(issue('YEAR_INVALID', { value: py.invalid }));
  else if ((yearCell == null || py.missing) && !pm.year) issues.push(issue('YEAR_MISSING'));
  else if (py.year && pm.year && py.year !== pm.year) {
    issues.push(issue('YEAR_MISMATCH', { year: String(py.year), monthYear: String(pm.year), ...colParams(COL.year) }));
  }

  const activity = text(v[COL.activity]) || text(v[COL.program]);
  const district = text(v[COL.district]);
  const commune = text(v[COL.commune]);
  const blank = (...cols) => cols.every((c) => v[c] == null); // vide (pas en erreur : déjà signalée)
  if (!activity && blank(COL.activity, COL.program)) issues.push(issue('ACTIVITY_MISSING', { col: colLetter(COL.activity), col2: colLetter(COL.program) }));
  if (!district && !commune && blank(COL.district, COL.commune)) issues.push(issue('ZONE_MISSING'));
  const mod = canonicalModality(v[COL.modality]);
  if (mod.unknown) issues.push(issue('MODALITY_UNKNOWN', { value: mod.unknown, expected: MODALITY_VALUES.join(', ') }));

  const month = rowMonth(pm, py);
  if (issues.length) return { skip: skipEntry(line, month, issues) };

  const items = {};
  for (const [c, name] of COMMODITIES) if (nums[c] > 0) items[name] = r3(nums[c]);
  const year = py.year || pm.year;
  return {
    row: {
      line, month: pm.month, year, periodMonth: month,
      activity, hazard: hazardOf(activity), wbs: text(v[COL.wbs]) || null, antenne: text(v[COL.antenne]) || null,
      sousBureau: text(v[COL.sousBureau]) || null, partner: text(v[COL.partner]) || null, corridor: text(v[COL.corridor]) || null,
      region: text(v[COL.region]), district, commune, modality: mod.value,
      beneficiaries: Math.round(nums[COL.beneficiaries]), households: Math.round(nums[COL.households]),
      cashUsd: r3(nums[COL.cashUsd]), totalFood: r3(nums[COL.totalFood]), items,
    },
  };
}

/** Ligne écartée : motifs structurés + texte français (« Motif ; motif. »). */
function skipEntry(line, month, issues) {
  return {
    line, month,
    message: sentence(issues.map((i) => i.message).join(' ; ')),
    issues: issues.map(({ code, params, template }) => ({ code, params, template })),
  };
}

// ---- Repérage de la feuille, de l'en-tête et de la plage -----------------
// En-têtes attendus aux positions lues (réel « Oct_Nov » ET modèle MEMS) :
// une colonne insérée/supprimée décalerait toutes les valeurs — on refuse.
const EXPECTED_HEADERS = [
  [COL.month, 'mois'], [COL.year, 'annee'], [COL.activity, 'activit'], [COL.region, 'region'], [COL.district, 'district'],
  [COL.commune, 'commune'], [COL.beneficiaries, /benef/], [COL.households, /menage/], [COL.modality, /modalit/],
  [COL.totalFood, /total/], [COL.cashUsd, /usd/],
  ...COMMODITIES.map(([c, name]) => [c, fold(name)]),
];
// En-têtes refusés même s'ils ressemblent : la colonne AQ est le cash en USD,
// jamais le montant en ariary (colonne AP « Cash-MGA » du classeur réel).
const REJECTED_HEADERS = { [COL.cashUsd]: /mga|ariary/ };

/** Écarts entre la ligne d'en-tête et la disposition attendue (pur). `headerAt(col)` → texte. */
function layoutIssues(headerAt) {
  const out = [];
  for (const [c, want] of EXPECTED_HEADERS) {
    const found = String(headerAt(c) || '').trim();
    const got = fold(found);
    if (REJECTED_HEADERS[c] && REJECTED_HEADERS[c].test(got)) {
      out.push(issue('LAYOUT_CASH_CURRENCY', { col: colLetter(c), found }));
      continue;
    }
    const ok = want instanceof RegExp ? want.test(got) : got.startsWith(want);
    if (!ok) out.push(found ? issue('LAYOUT_HEADER', { col: colLetter(c), found, label: COL_LABEL[c] }) : issue('LAYOUT_HEADER_EMPTY', { col: colLetter(c), label: COL_LABEL[c] }));
  }
  return out;
}

/**
 * Valeur d'une cellule SANS la créer (null si la ligne ou la cellule n'existe
 * pas). Pour une formule, le résultat est lu par `cell.result` : `cell.value`
 * d'exceljs OMET un résultat « faux » (0, '', false) — une formule qui vaut 0
 * paraîtrait non calculée.
 */
function peek(row, c) {
  const cell = row ? row.findCell(c) : undefined;
  if (!cell) return null;
  if (cell.type === ExcelJS.ValueType.Formula) return { formula: true, result: cell.result };
  return cell.value;
}
const headerText = (ws, r) => (c) => text(cellValue(peek(ws.findRow(r), c)));

/** Ligne d'en-tête (1–12) contenant « Mois » et « Commune » ; null sinon. */
function findHeaderRow(ws) {
  for (let r = 1; r <= HEADER_SCAN_ROWS; r += 1) {
    const row = ws.findRow(r);
    if (!row) continue;
    let hasMois = false; let hasCommune = false;
    row.eachCell((cell) => {
      const t = fold(text(cellValue(cell.value)));
      if (t === 'mois') hasMois = true;
      if (t === 'commune') hasCommune = true;
    });
    if (hasMois && hasCommune) return r;
  }
  return null;
}

/**
 * Tableau structuré (Insertion › Tableau) dont l'en-tête est `headerRow`, s'il
 * existe. `lastRow` = dernière ligne de sa plage (ligne de totaux comprise),
 * `dataLastRow` = dernière ligne de données (sans la ligne de totaux).
 */
function tableAt(ws, headerRow) {
  for (const t of ws.getTables ? ws.getTables() : []) {
    const model = t.table || t.model || t;
    const m = /^\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)$/i.exec(String(model.tableRef || model.ref || ''));
    if (m && Number(m[1]) === headerRow) {
      const lastRow = Number(m[2]);
      const totalsRow = Boolean(model.totalsRow);
      return { name: model.name || model.displayName || null, lastRow, totalsRow, dataLastRow: lastRow - (totalsRow ? 1 : 0) };
    }
  }
  return null;
}

/** Feuille PDD : « PDD base » d'abord, puis feuille à tableau structuré, puis ordre du classeur. */
function findPddSheet(wb) {
  const seen = new Set();
  const candidates = [];
  [wb.getWorksheet('PDD base'), ...wb.worksheets].forEach((ws, order) => {
    if (!ws || seen.has(ws.id)) return;
    seen.add(ws.id);
    const headerRow = findHeaderRow(ws);
    if (!headerRow) return;
    const table = tableAt(ws, headerRow);
    const rank = ws.name === 'PDD base' ? 0 : (table ? 1 : 2);
    candidates.push({ ws, headerRow, table, rank, order, layout: layoutIssues(headerText(ws, headerRow)) });
  });
  candidates.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return candidates.find((c) => c.layout.length === 0) || candidates[0] || null;
}

/** Avertissement groupé : lignes sans identité portant des erreurs Excel. */
function errorRowsWarning(lines, codes) {
  if (!lines.length) return null;
  const w = issue('ERROR_ROWS_WITHOUT_IDENTITY', { n: lines.length, errors: [...codes].join(', '), from: lines[0], to: lines[lines.length - 1] });
  return { line: lines[0], ...w, message: sentence(w.message) };
}

/**
 * Lignes ignorées qui interdisent un import « tout ou rien » : celles d'un mois
 * que l'import va REMPLACER (ses distributions seraient effacées sans être
 * réimportées) ou dont le mois est illisible (on ne peut pas l'exclure). Pur.
 * Marque chaque ligne (`blocking`) et renvoie leur nombre.
 */
function markBlocking(skippedRows, months) {
  const replaced = new Set(months);
  let count = 0;
  for (const s of skippedRows) {
    s.blocking = !s.month || replaced.has(s.month);
    if (s.blocking) count += 1;
  }
  return count;
}

/**
 * Lit le classeur PDD.
 * → { sheet, headerRow, firstLine, lastLine, table, rows, skipped, skippedRows,
 *     blocking, warnings, months, layoutIssues, tooManyRows? }
 *   - rows        : lignes valides (chacune garde son n° de `line` Excel) ;
 *   - skippedRows : [{ line, month, message, issues, blocking }] lignes écartées ;
 *   - blocking    : nombre de lignes écartées d'un mois remplacé ou illisible ;
 *   - warnings    : [{ line, code, params, template, message }] non bloquants ;
 *   - layoutIssues: disposition des colonnes non conforme (rien n'est lu) ;
 *   - tooManyRows : { limit, count } si la feuille dépasse `maxRows` (rien n'est lu).
 */
async function parsePddWorkbook(buffer, { maxRows = MAX_DATA_ROWS } = {}) {
  // Gardes (zones fusionnées, décompression) et nœuds sans incidence sur les valeurs ignorés.
  const wb = await loadWorkbook(buffer);
  const found = findPddSheet(wb);
  const base = { rows: [], skipped: 0, skippedRows: [], blocking: 0, warnings: [], months: [], layoutIssues: [] };
  if (!found) return { ...base, sheet: null };
  const { ws, headerRow, table } = found;
  const info = { sheet: ws.name, headerRow, table: table ? table.name : null, firstLine: headerRow + 1, lastLine: headerRow };
  if (found.layout.length) return { ...base, ...info, layoutIssues: found.layout };

  // Lignes EXISTANTES et non vides sous l'en-tête — rien n'est créé.
  const lines = [];
  ws.eachRow((row, n) => { if (n > headerRow) lines.push(row); });
  const lastLine = lines.length ? lines[lines.length - 1].number : headerRow;
  if (lines.length > maxRows) return { ...base, ...info, lastLine, tooManyRows: { limit: maxRows, count: lines.length } };

  const dataEnd = table ? table.dataLastRow : Infinity;
  const tableEnd = table ? table.lastRow : Infinity;
  const rows = []; const skippedRows = []; const errorLines = []; const errorCodes = new Set();
  for (const row of lines) {
    const n = row.number;
    if (n > dataEnd && n <= tableEnd) continue; // ligne de totaux du tableau Excel
    const res = parsePddRow((c) => peek(row, c), n);
    if (res.empty) {
      if (res.errors) { errorLines.push(n); res.errors.forEach((e) => errorCodes.add(e)); }
      continue;
    }
    if (n > tableEnd) {
      // Sous le tableau structuré : jamais importée en silence, ni perdue en silence.
      const month = res.row ? res.row.periodMonth : res.skip.month;
      skippedRows.push(skipEntry(n, month, [issue('OUTSIDE_TABLE', { table: table.name || '' })]));
    } else if (res.row) rows.push(res.row);
    else skippedRows.push(res.skip);
  }

  const months = [...new Set(rows.map((x) => x.periodMonth))].sort();
  const blocking = markBlocking(skippedRows, months);
  const warnings = [errorRowsWarning(errorLines, errorCodes)].filter(Boolean);
  return {
    ...base, ...info, lastLine, rows, months, blocking,
    skipped: skippedRows.length, skippedRows: skippedRows.slice(0, MAX_LISTED), warnings: warnings.slice(0, MAX_LISTED),
  };
}

module.exports = {
  parsePddWorkbook, parsePddRow, parseMonth, parseYear, canonicalModality, modalityKey, cellValue, toNumber, layoutIssues,
  markBlocking, colLetter, issue, render, COMMODITIES, COL, MODALITIES, MESSAGES, MAX_DATA_ROWS,
};
