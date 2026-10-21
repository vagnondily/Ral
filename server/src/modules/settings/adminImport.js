const os = require('os');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { DBFFile } = require('dbffile');
const { readShp, isGeographicPrj, plausible } = require('./shpReader');
const { readXls, isOleFile } = require('../monitoring/xlsReader');
const { breakdownFromChoices } = require('./xlsformAdmin');
const { loadWorkbook, isRefusal } = require('../common/xlsxGuard');
const { sheetTable } = require('../common/sheetRows');
const { sniffFile } = require('../common/fileSniff');
const { assertZipEntries, zipLimitsFromEnv } = require('../common/zipGuard');

/**
 * Import du découpage administratif (un fichier PAR PAYS / tenant) :
 * .csv/.txt, .dbf, ou .zip de shapefile(s). Les colonnes sont reconnues par
 * leur NOM, niveau par niveau : nom de l'unité (ADMn_FR, ADMn_EN, ADMn_NAME,
 * Région, District…) et P-code (ADMn_PCODE, …_CODE) — jamais l'inverse.
 * Avec un .shp, chaque unité la plus fine reçoit son centroïde (lat/lng) ;
 * les niveaux supérieurs sont dérivés à l'insertion.
 *
 * Sortie : { levels: [{ code, label, labelPlural }], rows: [{ names, pcodes, lat, lng }],
 *            warnings: string[], geo: 'shp'|'columns'|null, source }
 * Le niveau pays (adm0) est ignoré : le pays est décrit par le profil pays.
 */
const DEFAULT_LABELS = {
  adm1: ['Région', 'Régions'], adm2: ['District', 'Districts'], adm3: ['Commune', 'Communes'],
  adm4: ['Fokontany', 'Fokontany'], adm5: ['Village', 'Villages'],
};
// Colonnes « métier » sans préfixe ADMn : [regex, niveau].
const NAMED_LEVELS = [
  [/^(adm0|country|pays|nation)$/i, 0],
  [/^(province|region|région|faritra)$/i, 1],
  [/^(district|departement|département)$/i, 2],
  [/^(commune|kaominina|municipality)$/i, 3],
  [/^(fokontany|fokotany|village|locality|localite|localité|quartier)$/i, 4],
];
const NAME_SUFFIX_RANK = { FR: 1, EN: 2, NAME: 3, NOM: 3, LABEL: 4, MG: 5, '': 6 };
const IGNORED_SUFFIX = /^(REF|ALT|ALT\d?\w*|TYPE|DATE|VALIDON|VALIDTO|SHAPE|AREA|LEN|LENGTH|ID)$/i;

/**
 * Détecte, pour chaque niveau, la colonne du nom et celle du P-code. PUR.
 * @param {string[]} fields
 * @returns {{ levels: Array<{ n:number, code:string, nameField:string|null, pcodeField:string|null }>, latField:string|null, lngField:string|null }}
 */
function detectColumns(fields) {
  const byLevel = new Map();
  const slot = (n) => { if (!byLevel.has(n)) byLevel.set(n, { n, name: null, nameRank: 99, pcodeField: null }); return byLevel.get(n); };
  let latField = null; let lngField = null;
  for (const f of fields) {
    const name = String(f).trim();
    const adm = name.match(/^adm_?(\d)(?:_?([a-z]+\d?))?$/i);
    if (adm) {
      const n = Number(adm[1]); const suffix = (adm[2] || '').toUpperCase();
      if (/^(PCODE|PC|CODE|P_CODE)$/.test(suffix)) { const s = slot(n); if (!s.pcodeField) s.pcodeField = name; continue; }
      if (IGNORED_SUFFIX.test(suffix)) continue;
      const rank = NAME_SUFFIX_RANK[suffix] ?? 7;
      const s = slot(n); if (rank < s.nameRank) { s.name = name; s.nameRank = rank; }
      continue;
    }
    if (/^(lat|latitude|y|gps_lat)$/i.test(name)) { latField = latField || name; continue; }
    if (/^(lon|lng|long|longitude|x|gps_lng|gps_lon)$/i.test(name)) { lngField = lngField || name; continue; }
    const pc = name.match(/^(.*?)[ _-]?(p-?code|code)$/i);
    const base = pc ? pc[1] : name;
    const hit = NAMED_LEVELS.find(([re]) => re.test(base.trim()));
    if (!hit) continue;
    const s = slot(hit[1]);
    if (pc) { if (!s.pcodeField) s.pcodeField = name; } else if (s.nameRank > 6) { s.name = name; s.nameRank = 6; }
  }
  const levels = [...byLevel.values()].filter((l) => l.n > 0 && (l.name || l.pcodeField)).sort((a, b) => a.n - b.n)
    .map((l) => ({ n: l.n, code: `adm${l.n}`, nameField: l.name, pcodeField: l.pcodeField }));
  return { levels, latField, lngField };
}

const clean = (v) => (v == null ? '' : String(v).trim());
// Cellule vide → null (Number('') vaut 0 : un export réimporté plaçait tout en (0, 0)).
const num = (v) => { const t = String(v ?? '').trim(); if (!t) return null; const n = Number(t.replace(',', '.')); return Number.isFinite(n) ? n : null; };

/**
 * Lignes → { names, pcodes, lat, lng } selon les colonnes détectées. PUR.
 * @param {Array<object>} records  objets { colonne: valeur }
 * @param {ReturnType<typeof detectColumns>} cols
 * @param {Array<{lat,lng}|null>} [points]  centroïdes .shp (même ordre)
 */
function buildRows(records, cols, points = []) {
  const rows = [];
  records.forEach((r, i) => {
    const names = []; const pcodes = [];
    for (const l of cols.levels) {
      const nm = clean(l.nameField ? r[l.nameField] : '') || clean(l.pcodeField ? r[l.pcodeField] : '');
      if (!nm) break; // une chaîne s'arrête au premier niveau vide
      names.push(nm); pcodes.push(clean(l.pcodeField ? r[l.pcodeField] : '') || null);
    }
    if (!names.length) return;
    let pt = points[i] || null;
    if (!pt && cols.latField && cols.lngField) pt = { lat: num(r[cols.latField]), lng: num(r[cols.lngField]) };
    rows.push({ names, pcodes, lat: plausible(pt) ? pt.lat : null, lng: plausible(pt) ? pt.lng : null });
  });
  return rows;
}

function levelsOut(cols) {
  return cols.levels.map((l) => {
    const [label, labelPlural] = DEFAULT_LABELS[l.code] || [`Niveau ${l.n}`, `Niveau ${l.n}`];
    return { code: l.code, label, labelPlural };
  });
}

// ---- CSV ------------------------------------------------------------------
function detectDelimiter(line) {
  const counts = [',', ';', '\t'].map((d) => [d, line.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}
function splitLine(line, d) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true;
    else if (ch === d) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { levels: [], rows: [], warnings: ['Fichier vide.'], geo: null };
  const d = detectDelimiter(lines[0]);
  const header = splitLine(lines[0], d);
  const objects = lines.slice(1).map((l) => { const v = splitLine(l, d); return Object.fromEntries(header.map((h, i) => [h, v[i]])); });
  let cols = detectColumns(header);
  const warnings = [];
  if (!cols.levels.length) {
    // Format libre historique : chaque colonne = un niveau, dans l'ordre (libellé = en-tête).
    cols = { levels: header.map((h, i) => ({ n: i + 1, code: `adm${i + 1}`, nameField: h, pcodeField: null })), latField: null, lngField: null };
    const rows = buildRows(objects, cols);
    return { levels: header.map((h, i) => ({ code: `adm${i + 1}`, label: h, labelPlural: h })), rows, warnings: ['Colonnes non reconnues : chaque colonne est traitée comme un niveau (sans P-code).'], geo: null };
  }
  return { levels: levelsOut(cols), rows: buildRows(objects, cols), warnings, geo: cols.latField && cols.lngField ? 'columns' : null };
}

// ---- DBF / SHP ------------------------------------------------------------
// Encodage : celui du .cpg s'il existe ; sinon UTF-8, avec repli Latin-1 si le
// décodage UTF-8 produit des caractères de remplacement (anciens .dbf).
async function readDbf(buffer, cpg) {
  const tmp = path.join(os.tmpdir(), `mems-admin-${process.pid}-${Date.now()}.dbf`);
  fs.writeFileSync(tmp, buffer);
  const read = async (encoding) => {
    const dbf = await DBFFile.open(tmp, { encoding });
    return { fields: dbf.fields.map((f) => f.name), records: await dbf.readRecords() };
  };
  try {
    const declared = cpg && String(cpg).trim().replace(/^utf8$/i, 'utf-8');
    if (declared) { try { return await read(declared); } catch { /* encodage inconnu : on retombe sur la détection */ } }
    const utf = await read('utf-8');
    const broken = utf.records.some((r) => Object.values(r).some((v) => typeof v === 'string' && v.includes('\uFFFD')));
    return broken ? read('latin1') : utf;
  } finally { fs.unlink(tmp, () => {}); }
}

async function fromShapefile({ dbf, shp, prj, cpg }) {
  const { fields, records } = await readDbf(dbf, cpg);
  const cols = detectColumns(fields);
  const warnings = [];
  if (!cols.levels.length) throw new Error(`Aucune colonne de niveau administratif reconnue (attendu : ADM1_FR/ADM1_EN/ADM1_PCODE…, Région, District…). Colonnes : ${fields.join(', ')}`);
  let points = []; let geo = null;
  if (shp) {
    if (isGeographicPrj(prj)) {
      try { points = readShp(shp); geo = 'shp'; } catch (e) { warnings.push(`Géométrie illisible (${e.message}) : coordonnées non renseignées.`); }
      if (points.length && points.length !== records.length) { warnings.push('Le .shp et le .dbf n\'ont pas le même nombre d\'enregistrements : coordonnées ignorées.'); points = []; geo = null; }
    } else warnings.push('Projection non géographique (.prj) : coordonnées non renseignées (reprojetez en WGS84).');
  }
  return { levels: levelsOut(cols), rows: buildRows(records, cols, points), warnings, geo };
}

/** Dans un .zip à plusieurs shapefiles (adm1…adm4), retient le plus détaillé. */
function pickShapefile(entries) {
  const dbfs = entries.filter((e) => !e.isDirectory && /\.dbf$/i.test(e.entryName) && !/__MACOSX/.test(e.entryName));
  if (!dbfs.length) return null;
  const level = (n) => { const m = n.match(/adm_?(\d)/i); return m ? Number(m[1]) : -1; };
  dbfs.sort((a, b) => level(b.entryName) - level(a.entryName) || b.header.size - a.header.size);
  const base = dbfs[0].entryName.replace(/\.dbf$/i, '');
  const sib = (ext) => entries.find((e) => e.entryName.toLowerCase() === `${base}${ext}`.toLowerCase());
  return {
    dbf: dbfs[0].getData(), shp: sib('.shp')?.getData() || null, name: dbfs[0].entryName,
    prj: sib('.prj')?.getData().toString('utf8') || null, cpg: sib('.cpg')?.getData().toString('utf8') || null,
  };
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {{ shp?: Buffer, prj?: string }} [extra]  .shp/.prj envoyés à côté d'un .dbf
 */
// ---- XLSForm (listes de choix du référentiel officiel) ----------------------------
const cellText = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.result != null) return v.result;
    if (v.text != null) return v.text;
    return '';
  }
  return v;
};

/** Feuilles d'un classeur .xlsx / .xls → Map(nom en minuscules → lignes [tableaux]). */
async function workbookSheets(buffer) {
  if (isOleFile(buffer)) {
    const xls = readXls(buffer);
    return new Map(Object.entries(xls.sheets).map(([k, v]) => [k.trim().toLowerCase(), v]));
  }
  const wb = await loadWorkbook(buffer);
  // Feuilles lues À LA DEMANDE : une feuille que l'import n'utilise pas (même très large) n'est jamais parcourue.
  const byName = new Map(wb.worksheets.map((ws) => [ws.name.trim().toLowerCase(), ws]));
  const cache = new Map();
  return {
    get(name) {
      if (!cache.has(name)) cache.set(name, byName.has(name) ? sheetTable(byName.get(name)) : undefined);
      return cache.get(name);
    },
  };
}

function rowsToObjects(rows = []) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(cellText(h)).trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, cellText(r[i])]).filter(([h]) => h)));
}

/** Découpage lu dans les listes de choix (choices puis external_choices) d'un XLSForm. */
async function fromXlsform(buffer) {
  let sheets;
  try { sheets = await workbookSheets(buffer); } catch (err) {
    if (isRefusal(err)) throw err; // refus motivé de la garde (zone fusionnée, trop de colonnes…)
    throw new Error('Classeur illisible : fournissez un XLSForm .xlsx ou .xls.');
  }
  const choices = [...rowsToObjects(sheets.get('choices')), ...rowsToObjects(sheets.get('external_choices'))];
  const r = breakdownFromChoices(choices);
  if (!r) {
    throw new Error('Ce classeur ne contient pas de listes de codes officiels reliées entre elles (feuille « choices » d\'un XLSForm, ex. ADM1CODE › ADM2CODE). Fournissez le XLSForm du référentiel ou un shapefile.');
  }
  const summary = `Découpage lu dans les listes ${r.lists.map((l) => `${l.list} (${l.count})`).join(' › ')} du XLSForm.`;
  return { levels: r.levels, rows: r.rows, warnings: [summary, ...r.warnings] };
}

async function parseUpload(buffer, filename, extra = {}) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  let out;
  if (ext === 'xlsx' || ext === 'xls' || isOleFile(buffer)) out = await fromXlsform(buffer);
  else if (ext === 'csv' || ext === 'txt') out = parseCsv(buffer.toString('utf8'));
  else if (ext === 'dbf') out = await fromShapefile({ dbf: buffer, shp: extra.shp || null, prj: extra.prj || null });
  else if (ext === 'zip') {
    // Garde de décompression AVANT d'ouvrir l'archive (comme tous les autres imports).
    const sniff = sniffFile(buffer);
    if (sniff.kind !== 'zip' || !sniff.entries) throw new Error('Archive .zip illisible.');
    assertZipEntries(sniff.entries, zipLimitsFromEnv(process.env), { archiveBytes: buffer.length });
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const shp = pickShapefile(entries);
    if (shp) out = await fromShapefile(shp);
    else {
      const csvEntry = entries.find((e) => /\.(csv|txt)$/i.test(e.entryName));
      if (!csvEntry) throw new Error('Le .zip ne contient ni shapefile (.dbf) ni .csv.');
      out = parseCsv(csvEntry.getData().toString('utf8'));
    }
  } else if (['shp', 'shx', 'prj', 'cpg', 'sbn', 'sbx', 'qpj', 'qix'].includes(ext)) {
    // Un shapefile est un ENSEMBLE de fichiers : le .shp seul n'a pas les noms (ils sont dans le .dbf).
    throw new Error('Un shapefile est un ENSEMBLE de fichiers (.shp + .dbf + .shx + .prj…), pas un seul. Sélectionnez-les TOUS, compressez-les dans un .zip, puis importez le .zip. (À défaut, le .dbf seul suffit : il porte les noms des zones.)');
  } else throw new Error('Format non supporté : fournissez un .csv, un .dbf, un .zip (shapefile) ou le XLSForm du référentiel (.xlsx, .xls).');
  return { ...out, source: filename };
}

module.exports = { parseUpload, detectColumns, buildRows, parseCsv, pickShapefile, DEFAULT_LABELS };
