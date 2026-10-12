const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const {
  parsePddWorkbook, parsePddRow, parseMonth, parseYear, canonicalModality, cellValue, toNumber,
} = require('../src/modules/pdd/pddImport');

// En-têtes du classeur réel (feuille « Oct_Nov », tableau « Table1 » A5:AU…).
const HEADERS = ['Mois', 'Annee', 'WBS', 'Type Activité', 'F2_24_Acti', 'Act', 'Activites_principal', 'Activite ref Pipeline ',
  'Activité tag-1 (COMET)', 'Antenne', 'Sous Bureau', 'Partenaires', 'Corridor', 'Region', 'District', 'COMMUNE', 'PDFs ', 'Male',
  'Female ', 'Total bénéficiaires', 'Menages ', 'Modalites ', 'Modèle', 'Donateur', 'Type denrees', 'Jour', 'Riz', 'Mais Concassé',
  'Mais en Grain', 'Sorgho', 'LS', 'Huile ', 'MNP', 'P Sup', 'CSB+', 'CSB++', 'P Doz', 'LNS-sq/Nutributter ', 'Dattes', 'HEB',
  'Total - Food', 'Cash-MGA', 'Cash-USD', 'OBS', 'OIL', 'CSB', 'LNS'];

/** Ligne de 47 colonnes au format réel ; `over` = { n° de colonne: valeur }. */
function line({ month = 'Octobre', year = 2025, activity = 'GD drought ', ref = 'GD', region = 'Anosy', district = 'Amboasary-Atsimo',
  commune = 'Ebelo', ben = 13318.36, hh = 2663.67, modality = 'Inkind', over = {} } = {}) {
  const v = new Array(47).fill(null);
  Object.assign(v, { 0: month, 1: year, 2: 'URT1', 3: 'GD', 4: 'Urg_sech', 5: 'Convergence', 6: activity, 7: ref,
    9: 'Taolagnaro', 10: 'Ambovombe', 13: region, 14: district, 15: commune, 19: ben, 20: hh, 21: modality, 25: 15,
    29: 95.892, 31: 11.987, 40: 107.879, 42: 0 });
  for (const [c, x] of Object.entries(over)) v[Number(c) - 1] = x;
  return v;
}

/** Classeur à la forme du réel : une feuille de synthèse (TCD) AVANT la feuille
 * de données ; titre lignes 1–2, ligne 3 vide, une valeur isolée ligne 4 (taux),
 * en-tête ligne 5, tableau structuré, cellules mises en forme très bas. */
async function realLikeWorkbook(rows, { below = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  const pivot = wb.addWorksheet('Sommary GD DROUDGT');
  pivot.getRow(8).values = ['Mois', null, null, null, null, 'COMMUNE', 'Somme de Total - Food'];
  pivot.getRow(9).values = ['Octobre', null, null, null, null, 'Ebelo', 107.879];
  const ws = wb.addWorksheet('Oct_Nov');
  ws.getCell('A1').value = 'PDD Urgence';
  ws.getCell('A2').value = 'Octobre – Mars';
  ws.getCell('AQ4').value = 4432; // ligne 4 porte une valeur, la ligne 3 aucune
  ws.addTable({ name: 'Table1', ref: 'A5', headerRow: true, columns: HEADERS.map((name) => ({ name })), rows });
  below.forEach(([r, c, x]) => { ws.getRow(r).getCell(c).value = x; });
  ws.getCell('A5000').style = { font: { bold: true } }; // cellule formatée, sans valeur
  return wb.xlsx.writeBuffer();
}

test('classeur au format réel : la feuille de données est choisie et la DERNIÈRE ligne est lue', async () => {
  const rows = [
    line(),
    line({ month: 'Fevrier', year: 2026, activity: 'GFD Cyclone', commune: 'Ambanisarika' }), // « Fevrier » sans accent
    line({ month: 'Novembre', modality: 'CBT', commune: 'Ifotaka', over: { 30: 0, 32: 0, 41: 0, 43: 65888.36 } }),
    line({ month: 'Mars', year: 2026, activity: 'GFD Cyclone', ref: 'PrevMa (PBW)', region: 'Fitovinany', district: 'Vondrozo',
      commune: 'Antokonala  ', ben: 475.59, hh: 475.59, over: { 30: 0, 32: 0.285, 35: 2.854, 41: 3.139 } }),
  ];
  const buf = await realLikeWorkbook(rows);
  const p = await parsePddWorkbook(buf);
  assert.equal(p.sheet, 'Oct_Nov'); // pas la synthèse placée avant, qui a aussi « Mois » et « COMMUNE »
  assert.equal(p.table, 'Table1');
  assert.equal(p.headerRow, 5);
  assert.equal(p.lastLine, 9);
  assert.deepEqual(p.layoutIssues, []);
  assert.equal(p.rows.length, 4);
  assert.equal(p.skipped, 0);
  assert.deepEqual(p.warnings, []);
  const last = p.rows[3];
  assert.equal(last.line, 9);
  assert.equal(last.periodMonth, '2026-03-01');
  assert.equal(last.commune, 'Antokonala');
  assert.equal(last.district, 'Vondrozo');
  assert.equal(last.hazard, 'cyclone');
  assert.deepEqual(last.items, { Huile: 0.285, 'CSB+': 2.854 });
  assert.equal(p.rows[1].periodMonth, '2026-02-01');
  assert.equal(p.rows[2].modality, 'CBT');
  assert.equal(p.rows[2].cashUsd, 65888.36);
  assert.deepEqual(p.months, ['2025-10-01', '2025-11-01', '2026-02-01', '2026-03-01']);
});

test('erreurs Excel, mois inconnu, année absente, zone vide, non numérique : lignes écartées et listées avec leur motif', async () => {
  const rows = [
    line({ commune: 'OK-1', over: { 6: { formula: 'VLOOKUP(P6,X:Y,2,FALSE)', result: { error: '#N/A' } } } }), // erreur hors colonnes lues : ligne gardée
    line({ month: 'Octobr' }),
    line({ over: { 27: { error: '#REF!' } } }),
    line({ hh: { formula: 'VLOOKUP(P9,X:Y,5,FALSE)', result: { error: '#N/A' } } }),
    line({ over: { 41: { formula: 'SUM(AA10:AN10)', result: { error: '#VALUE!' } }, 43: { error: '#DIV/0!' } } }),
    line({ ben: 'abc' }),
    line({ district: null, commune: null }),
    line({ year: null }),
    line({ modality: 'Voucher' }),
    line({ ben: -5 }),
    line({ activity: null, over: { 4: null } }),
    line({ commune: 'OK-2', modality: 'Vivres' }),
  ];
  const p = await parsePddWorkbook(await realLikeWorkbook(rows));
  assert.deepEqual(p.rows.map((r) => r.commune), ['OK-1', 'OK-2']);
  assert.equal(p.rows[1].modality, 'Inkind'); // « Vivres » ramené à la valeur canonique
  assert.equal(p.skipped, 10);
  const by = Object.fromEntries(p.skippedRows.map((s) => [s.line, s.message]));
  assert.deepEqual(Object.keys(by).map(Number), [7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.match(by[7], /mois inconnu « Octobr »/i);
  assert.match(by[8], /#REF! en colonne AA \(Riz\)/);
  assert.match(by[9], /#N\/A en colonne U \(Ménages\)/);
  assert.match(by[10], /#VALUE! en colonne AO/);
  assert.match(by[10], /#DIV\/0! en colonne AQ/);
  assert.match(by[11], /valeur non numérique « abc » en colonne T \(Bénéficiaires\)/i);
  assert.match(by[12], /zone absente/i);
  assert.match(by[13], /année absente/i); // jamais remplacée par l'année courante
  assert.match(by[14], /modalité inconnue « Voucher »/i);
  assert.match(by[15], /valeur négative/i);
  assert.match(by[16], /activité absente/i);
  // Aucune valeur en erreur n'a été lue comme 0 : aucune ligne fautive importée.
  assert.ok(p.rows.every((r) => r.commune.startsWith('OK')));
});

test('valeurs sous le tableau structuré : non lues, signalées par un avertissement', async () => {
  const buf = await realLikeWorkbook([line(), line({ commune: 'Ifotaka' })], { below: [[9, 1, 'Novembre'], [9, 16, 'Hors tableau']] });
  const p = await parsePddWorkbook(buf);
  assert.equal(p.lastLine, 7);
  assert.equal(p.rows.length, 2);
  assert.equal(p.warnings.length, 1);
  assert.equal(p.warnings[0].line, 8);
  assert.match(p.warnings[0].message, /sous le tableau Excel « Table1 »/);
});

test('sans tableau structuré : lecture jusqu\'à la dernière ligne non vide, même après des lignes vides', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PDD base');
  ws.getRow(5).values = HEADERS;
  ws.getRow(6).values = line();
  ws.getRow(9).values = line({ month: 'décembre', commune: 'Dernière' }); // lignes 7–8 vides, ligne 3 vide
  ws.getCell('A200000').style = { font: { italic: true } };
  const p = await parsePddWorkbook(await wb.xlsx.writeBuffer());
  assert.equal(p.sheet, 'PDD base');
  assert.equal(p.table, null);
  assert.equal(p.lastLine, 9);
  assert.deepEqual(p.rows.map((r) => [r.line, r.periodMonth, r.commune]), [[6, '2025-10-01', 'Ebelo'], [9, '2025-12-01', 'Dernière']]);
  assert.equal(p.skipped, 0);
});

test('colonne insérée : disposition refusée, rien n\'est lu', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PDD base');
  ws.getRow(5).values = ['Mois', 'Annee', 'Nouvelle colonne', ...HEADERS.slice(2)]; // tout est décalé d'une colonne
  ws.getRow(6).values = ['Octobre', 2025, 'x', ...line().slice(2)];
  const p = await parsePddWorkbook(await wb.xlsx.writeBuffer());
  assert.equal(p.sheet, 'PDD base');
  assert.equal(p.rows.length, 0);
  assert.ok(p.layoutIssues.length > 0);
  assert.ok(p.layoutIssues.some((m) => /colonne P/.test(m)));
});

test('aucune feuille PDD : sheet null', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Autre').getCell('A1').value = 'rien';
  const p = await parsePddWorkbook(await wb.xlsx.writeBuffer());
  assert.equal(p.sheet, null);
  assert.equal(p.rows.length, 0);
});

// ---- Fonctions pures --------------------------------------------------------
test('parseMonth : noms FR/EN sans accents, numéros, dates ; inconnu signalé', () => {
  assert.deepEqual(parseMonth('Fevrier'), { month: 2 });
  assert.deepEqual(parseMonth('  FÉVRIER '), { month: 2 });
  assert.deepEqual(parseMonth('août'), { month: 8 });
  assert.deepEqual(parseMonth('October'), { month: 10 });
  assert.deepEqual(parseMonth(10), { month: 10 });
  assert.deepEqual(parseMonth('03'), { month: 3 });
  assert.deepEqual(parseMonth('Octobre 2025'), { month: 10, year: 2025 });
  assert.deepEqual(parseMonth(new Date(Date.UTC(2026, 2, 1))), { month: 3, year: 2026 });
  assert.deepEqual(parseMonth(null), { missing: true });
  assert.deepEqual(parseMonth('Octobr'), { unknown: 'Octobr' });
  assert.deepEqual(parseMonth(13), { unknown: '13' });
});

test('parseYear : 4 chiffres requis, jamais l\'année courante par défaut', () => {
  assert.deepEqual(parseYear(2026), { year: 2026 });
  assert.deepEqual(parseYear('2025'), { year: 2025 });
  assert.deepEqual(parseYear(null), { missing: true });
  assert.deepEqual(parseYear(25), { invalid: '25' });
  assert.deepEqual(parseYear('deux mille'), { invalid: 'deux mille' });
});

test('canonicalModality : modalités réelles et du modèle ramenées à Inkind / CBT / Mixte', () => {
  for (const x of ['Inkind', 'In-kind', 'IN KIND', 'Vivres', 'food']) assert.deepEqual(canonicalModality(x), { value: 'Inkind' }, x);
  for (const x of ['CBT', 'Cash', 'cash-based transfer', 'Transfert monétaire']) assert.deepEqual(canonicalModality(x), { value: 'CBT' }, x);
  for (const x of ['Mixte', 'Mixed', 'Inkind+CBT', 'Vivres + Cash']) assert.deepEqual(canonicalModality(x), { value: 'Mixte' }, x);
  assert.deepEqual(canonicalModality(null), { value: null });
  assert.deepEqual(canonicalModality('  '), { value: null });
  assert.deepEqual(canonicalModality('Voucher'), { unknown: 'Voucher' });
});

test('cellValue / toNumber : erreurs Excel isolées, nombres stricts', () => {
  assert.deepEqual(cellValue({ error: '#REF!' }), { error: '#REF!' });
  assert.deepEqual(cellValue({ formula: 'A1/0', result: { error: '#DIV/0!' } }), { error: '#DIV/0!' });
  assert.deepEqual(cellValue(' #N/A '), { error: '#N/A' }); // erreur collée comme texte
  assert.equal(cellValue({ formula: 'A1*2', result: 4 }), 4);
  assert.equal(cellValue({ formula: 'A1*2' }), null); // pas de résultat en cache
  assert.equal(cellValue({ richText: [{ text: 'Ebe' }, { text: 'lo' }] }), 'Ebelo');
  assert.equal(toNumber('1 250,5'), 1250.5);
  assert.equal(toNumber(12), 12);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber('-'), null);
  assert.ok(Number.isNaN(toNumber('abc')));
  assert.ok(Number.isNaN(toNumber('1,250.5'))); // séparateurs ambigus : jamais deviné
  assert.ok(Number.isNaN(toNumber(true)));
});

test('parsePddRow : ligne vide ignorée sans être comptée', () => {
  assert.deepEqual(parsePddRow(() => null, 10), { empty: true });
  // Formule sans résultat (ex. total d'une ligne de saisie vide du modèle) : vide aussi.
  assert.deepEqual(parsePddRow((c) => (c === 41 ? { formula: 'SUM(AA10:AN10)' } : null), 10), { empty: true });
  // Des chiffres sans mois ni zone : ce n'est pas une ligne vide, elle est signalée.
  const r = parsePddRow((c) => (c === 20 ? 120 : null), 11);
  assert.equal(r.skip.line, 11);
  assert.match(r.skip.message, /mois absent/i);
});

test('parsePddRow : année portée par le mois, année incohérente ou invalide, valeur hors limites', () => {
  const base = { 1: 'Octobre', 2: 2025, 7: 'GD drought', 15: 'Amboasary', 16: 'Ebelo', 20: 100 };
  const at = (over) => (c) => (c in over ? over[c] : (base[c] ?? null));
  assert.equal(parsePddRow(at({ 1: 'Octobre 2025', 2: null }), 6).row.periodMonth, '2025-10-01');
  assert.match(parsePddRow(at({ 1: new Date(Date.UTC(2026, 0, 1)), 2: 2025 }), 7).skip.message, /année incohérente/i);
  assert.match(parsePddRow(at({ 43: 5e12 }), 8).skip.message, /hors limites/);
  assert.match(parsePddRow(at({ 2: 25 }), 9).skip.message, /année invalide « 25 »/i);
});
