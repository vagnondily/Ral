const ExcelJS = require('exceljs');

/**
 * Parseur du tableau PDD (Plan de Distribution d'urgence) : feuille « PDD base »
 * du modèle MEMS, ou feuille du classeur réel (ex. « Oct_Nov », tableau Excel
 * « Table1 »). En-tête repéré dans les 12 premières lignes (« Mois » en A et
 * « Commune » en P), données juste en dessous. Lit les RÉSULTATS des formules
 * (bénéficiaires, tonnages). Aucune I/O : l'insertion est faite par le repo.
 *
 * Fiabilité :
 *  • la lecture est bornée UNE fois (plage du tableau structuré, sinon dernière
 *    ligne non vide) — jamais de `actualRowCount` / `columnCount` recalculé par
 *    ligne, qui parcourt toute la feuille (≈ 1 million de lignes formatées sur
 *    le classeur réel) et faisait aussi perdre la dernière ligne ;
 *  • une ligne écartée est TOUJOURS listée avec son motif (`skippedRows`) ;
 *  • une erreur Excel (#REF!, #N/A, #VALUE!, #DIV/0!…) n'est jamais lue comme 0 :
 *    la ligne est écartée et signalée ;
 *  • mois, année et modalité sont contrôlés (listes ci-dessous) — rien n'est
 *    deviné en silence (pas d'année courante par défaut).
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

/** Lettre de colonne Excel (1 → A, 27 → AA). */
function colLetter(n) {
  let s = ''; let x = n;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}
const colName = (c) => `${colLetter(c)} (${COL_LABEL[c] || '?'})`;
/** Minuscules sans accents ni espaces superflus. */
const fold = (v) => String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// ---- Lecture d'une cellule ----------------------------------------------
const EXCEL_ERRORS = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#GETTING_DATA', '#SPILL!', '#CALC!', '#FIELD!', '#BLOCKED!', '#CONNECT!', '#BUSY!', '#UNKNOWN!']);
const isError = (v) => v != null && typeof v === 'object' && !(v instanceof Date) && 'error' in v;

/**
 * Valeur exploitable d'une valeur de cellule exceljs : résultat des formules,
 * texte riche aplati, lien → texte. Une erreur Excel (typée, en résultat de
 * formule, ou saisie comme texte « #N/A ») devient `{ error: '#N/A' }` — jamais
 * `null` ni 0. Une formule sans résultat en cache est lue comme vide.
 */
function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.error != null) return { error: String(v.error) };
    if ('formula' in v || 'sharedFormula' in v) return cellValue(v.result);
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

/** Texte d'une valeur (déjà passée par cellValue) ; '' si vide ou erreur. */
function text(v) {
  if (v == null || isError(v)) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/** Nombre d'une valeur : null si vide, NaN si non numérique. Accepte « 1 250,5 ». */
function toNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN; // date, booléen, erreur
  const t = v.replace(/[\s\u00a0\u202f]/g, '');
  if (t === '' || t === '-' || t === '—') return null;
  if (t.includes(',') && t.includes('.')) return NaN; // séparateurs ambigus : ne pas deviner
  const n = t.replace(',', '.');
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(n) ? Number(n) : NaN;
}

// ---- Listes contrôlées ----------------------------------------------------
const MONTHS = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * Mois d'une cellule : nom français ou anglais (accents et casse indifférents,
 * ex. « Fevrier »), numéro 1–12, date Excel, ou « Octobre 2025 ».
 * → { month, year? } | { missing: true } | { unknown: 'texte lu' }
 */
function parseMonth(v) {
  if (v == null || v === '') return { missing: true };
  if (v instanceof Date) return { month: v.getUTCMonth() + 1, year: v.getUTCFullYear() };
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 12 ? { month: v } : { unknown: String(v) };
  const f = fold(v);
  if (/^\d{1,2}$/.test(f)) { const m = Number(f); return m >= 1 && m <= 12 ? { month: m } : { unknown: String(v) }; }
  const m = /^([a-z]+)\.?(?:[\s\-_/]+(\d{4}))?$/.exec(f);
  if (m && MONTHS[m[1]]) return m[2] ? { month: MONTHS[m[1]], year: Number(m[2]) } : { month: MONTHS[m[1]] };
  return { unknown: String(v).trim() };
}

/** Année : entier 2000–2100 (nombre, texte « 2026 » ou date). → { year } | { missing } | { invalid } */
function parseYear(v) {
  if (v == null || v === '') return { missing: true };
  if (v instanceof Date) return { year: v.getUTCFullYear() };
  const n = toNumber(v);
  if (n == null) return { missing: true };
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? { year: n } : { invalid: String(v).trim() };
}

/**
 * Modalités canoniques (valeur enregistrée) et synonymes acceptés à l'import.
 * Le classeur réel utilise « Inkind » et « CBT » ; l'ancien modèle MEMS
 * proposait « Vivres », « Cash » et « Mixte ». Comparaison sans casse, accents,
 * espaces ni ponctuation (« In-kind » = « inkind »).
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

/** → { value: 'Inkind'|'CBT'|'Mixte'|null } | { unknown: 'texte lu' } */
function canonicalModality(v) {
  const raw = text(v);
  if (!raw) return { value: null };
  const key = fold(raw).replace(/[^a-z0-9]/g, '');
  return MODALITY_BY_KEY[key] ? { value: MODALITY_BY_KEY[key] } : { unknown: raw };
}

const hazardOf = (activity) => (/cyclone/i.test(activity) ? 'cyclone' : (/drought|s[ée]ch/i.test(activity) ? 'drought' : 'autre'));
const r3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Lit UNE ligne du tableau. `at(col)` renvoie la valeur exceljs brute de la
 * colonne. Pur : aucune I/O.
 * → { empty: true } (ligne vide : ni lue ni comptée)
 *   | { skip: { line, message } } (ligne écartée, motif(s) en clair)
 *   | { row } (ligne de distribution prête à insérer)
 */
function parsePddRow(at, line) {
  const v = {};
  for (const c of READ_COLS) v[c] = cellValue(at(c));
  const issues = [];

  for (const c of READ_COLS) if (isError(v[c])) issues.push(`erreur Excel ${v[c].error} en colonne ${colName(c)}`);

  const nums = {};
  let hasFigure = false;
  for (const c of NUMBER_COLS) {
    if (isError(v[c])) continue;
    const n = toNumber(v[c]);
    if (Number.isNaN(n)) { issues.push(`valeur non numérique « ${text(v[c]) || String(v[c])} » en colonne ${colName(c)}`); continue; }
    if (n != null && n < 0) issues.push(`valeur négative (${n}) en colonne ${colName(c)}`);
    else if (n != null && n > MAX_VALUE) issues.push(`valeur hors limites (${n}) en colonne ${colName(c)}`);
    nums[c] = n || 0;
    if (n) hasFigure = true;
  }

  const activity = text(v[COL.activity]) || text(v[COL.program]);
  const district = text(v[COL.district]);
  const commune = text(v[COL.commune]);
  const identity = [COL.month, COL.activity, COL.program, COL.district, COL.commune].some((c) => v[c] != null);
  // Ligne sans mois, activité ni zone, et sans chiffre : ligne vide (ex. lignes de saisie du modèle).
  if (!identity && !hasFigure) return { empty: true };

  const pm = parseMonth(isError(v[COL.month]) ? null : v[COL.month]);
  if (!isError(v[COL.month])) {
    if (pm.missing) issues.push('mois absent');
    else if (pm.unknown) issues.push(`mois inconnu « ${pm.unknown} »`);
  }
  const py = parseYear(isError(v[COL.year]) ? null : v[COL.year]);
  let year = py.year || pm.year || null;
  if (!isError(v[COL.year])) {
    if (py.invalid) { issues.push(`année invalide « ${py.invalid} » (attendu : 4 chiffres, ex. 2026)`); year = null; }
    else if (py.missing && !pm.year) issues.push('année absente');
    else if (py.year && pm.year && py.year !== pm.year) issues.push(`année incohérente (${py.year} en colonne ${colName(COL.year)}, ${pm.year} dans le mois)`);
  }
  if (!activity) issues.push(`activité absente (colonne ${colLetter(COL.activity)} ou ${colLetter(COL.program)})`);
  if (!district && !commune) issues.push(`zone absente (district et commune vides)`);
  const mod = canonicalModality(v[COL.modality]);
  if (mod.unknown) issues.push(`modalité inconnue « ${mod.unknown} » (attendu : ${MODALITY_VALUES.join(', ')} — ou Vivres, Cash)`);

  if (issues.length) {
    const msg = issues.join(' ; ');
    return { skip: { line, message: msg.charAt(0).toUpperCase() + msg.slice(1) + '.' } };
  }

  const month = pm.month;
  const items = {};
  for (const [c, name] of COMMODITIES) if (nums[c] > 0) items[name] = r3(nums[c]);
  return {
    row: {
      line, month, year, periodMonth: `${year}-${String(month).padStart(2, '0')}-01`,
      activity, hazard: hazardOf(activity), wbs: text(v[COL.wbs]) || null, antenne: text(v[COL.antenne]) || null,
      sousBureau: text(v[COL.sousBureau]) || null, partner: text(v[COL.partner]) || null, corridor: text(v[COL.corridor]) || null,
      region: text(v[COL.region]), district, commune, modality: mod.value,
      beneficiaries: Math.round(nums[COL.beneficiaries]), households: Math.round(nums[COL.households]),
      cashUsd: r3(nums[COL.cashUsd]), totalFood: r3(nums[COL.totalFood]), items,
    },
  };
}

// ---- Repérage de la feuille, de l'en-tête et de la plage -----------------
// En-têtes attendus aux positions lues (réel « Oct_Nov » ET modèle MEMS) :
// une colonne insérée/supprimée décalerait toutes les valeurs — on refuse.
const EXPECTED_HEADERS = [
  [COL.month, 'mois'], [COL.year, 'annee'], [COL.activity, 'activit'], [COL.region, 'region'], [COL.district, 'district'],
  [COL.commune, 'commune'], [COL.beneficiaries, /benef/], [COL.households, /menage/], [COL.modality, /modalit/],
  [COL.totalFood, /total/], [COL.cashUsd, /cash/],
  ...COMMODITIES.map(([c, name]) => [c, fold(name)]),
];

/** Écarts entre la ligne d'en-tête et la disposition attendue (pur). `headerAt(col)` → texte. */
function layoutIssues(headerAt) {
  const issues = [];
  for (const [c, want] of EXPECTED_HEADERS) {
    const got = fold(headerAt(c));
    const ok = want instanceof RegExp ? want.test(got) : got.startsWith(want);
    if (!ok) issues.push(`colonne ${colLetter(c)} : en-tête « ${String(headerAt(c) || '').trim() || '(vide)'} » au lieu de « ${COL_LABEL[c]} »`);
  }
  return issues;
}

const headerText = (ws, r) => (c) => text(cellValue(ws.getRow(r).getCell(c).value));

/** Ligne d'en-tête (1–12) contenant « Mois » et « Commune » ; null sinon. */
function findHeaderRow(ws) {
  const last = Math.min(ws.rowCount, HEADER_SCAN_ROWS);
  for (let r = 1; r <= last; r += 1) {
    let hasMois = false; let hasCommune = false;
    ws.getRow(r).eachCell((cell) => {
      const t = fold(text(cellValue(cell.value)));
      if (t === 'mois') hasMois = true;
      if (t === 'commune') hasCommune = true;
    });
    if (hasMois && hasCommune) return r;
  }
  return null;
}

/** Tableau structuré (Insertion › Tableau) dont l'en-tête est `headerRow`, s'il existe. */
function tableAt(ws, headerRow) {
  for (const t of ws.getTables ? ws.getTables() : []) {
    const model = t.table || t.model || t;
    const m = /^\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)$/i.exec(String(model.tableRef || model.ref || ''));
    if (m && Number(m[1]) === headerRow) {
      return { name: model.name || model.displayName || null, lastRow: Number(m[2]) - (model.totalsRow ? 1 : 0) };
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

/** Dernière ligne portant une valeur — UN seul parcours de la feuille. */
function lastFilledRow(ws) {
  let last = 0;
  ws.eachRow((row, n) => { if (n > last) last = n; });
  return last;
}

/**
 * Lit le classeur PDD.
 * → { sheet, headerRow, firstLine, lastLine, table, rows, skipped, skippedRows,
 *     warnings, months, layoutIssues }
 *   - rows        : lignes valides (chacune garde son n° de `line` Excel) ;
 *   - skippedRows : [{ line, message }] lignes écartées et leur motif ;
 *   - warnings    : [{ line, message }] remarques non bloquantes ;
 *   - layoutIssues: disposition des colonnes non conforme (rien n'est lu).
 */
async function parsePddWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  // Nœuds sans incidence sur les valeurs : ignorés pour charger plus vite.
  await wb.xlsx.load(buffer, { ignoreNodes: ['dataValidations', 'conditionalFormatting', 'drawing', 'picture', 'extLst'] });
  const found = findPddSheet(wb);
  const base = { rows: [], skipped: 0, skippedRows: [], warnings: [], months: [], layoutIssues: [] };
  if (!found) return { ...base, sheet: null };
  const { ws, headerRow, table } = found;
  const info = { sheet: ws.name, headerRow, table: table ? table.name : null, firstLine: headerRow + 1 };
  if (found.layout.length) return { ...base, ...info, lastLine: headerRow, layoutIssues: found.layout };

  // Bornes calculées UNE fois : plage du tableau structuré (sans ses lignes vides
  // de fin), sinon dernière ligne non vide.
  const filled = lastFilledRow(ws);
  const lastLine = table ? Math.min(table.lastRow, filled) : filled;
  const warnings = [];
  if (table && filled > table.lastRow) {
    warnings.push({ line: table.lastRow + 1, message: `Des valeurs figurent sous le tableau Excel « ${table.name || ''} » (lignes ${table.lastRow + 1} à ${filled}) : elles ne sont pas lues. Étendez le tableau pour les importer.` });
  }

  const rows = []; const skippedRows = [];
  for (let r = headerRow + 1; r <= lastLine; r += 1) {
    const row = ws.getRow(r);
    const res = parsePddRow((c) => row.getCell(c).value, r);
    if (res.row) rows.push(res.row);
    else if (res.skip) skippedRows.push(res.skip);
  }
  const months = [...new Set(rows.map((x) => x.periodMonth))].sort();
  return {
    ...base, ...info, lastLine, rows, months,
    skipped: skippedRows.length, skippedRows: skippedRows.slice(0, MAX_LISTED), warnings: warnings.slice(0, MAX_LISTED),
  };
}

module.exports = {
  parsePddWorkbook, parsePddRow, parseMonth, parseYear, canonicalModality, cellValue, toNumber, layoutIssues, colLetter,
  COMMODITIES, COL, MODALITIES,
};
