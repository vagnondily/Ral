const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const Worksheet = require('exceljs/lib/doc/worksheet');
const Row = require('exceljs/lib/doc/row');
const {
  parsePddWorkbook, parsePddRow, parseMonth, parseYear, canonicalModality, cellValue, toNumber, layoutIssues, markBlocking,
  MESSAGES, COL,
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
async function realLikeWorkbook(rows, { below = [], totalsRow = false } = {}) {
  const wb = new ExcelJS.Workbook();
  const pivot = wb.addWorksheet('Sommary GD DROUDGT');
  pivot.getRow(8).values = ['Mois', null, null, null, null, 'COMMUNE', 'Somme de Total - Food'];
  pivot.getRow(9).values = ['Octobre', null, null, null, null, 'Ebelo', 107.879];
  const ws = wb.addWorksheet('Oct_Nov');
  ws.getCell('A1').value = 'PDD Urgence';
  ws.getCell('A2').value = 'Octobre – Mars';
  ws.getCell('AQ4').value = 4432; // ligne 4 porte une valeur, la ligne 3 aucune
  const columns = HEADERS.map((name, i) => {
    if (!totalsRow) return { name };
    if (i === 0) return { name, totalsRowLabel: 'Total' };
    return [19, 20, 40, 42].includes(i) ? { name, totalsRowFunction: 'sum' } : { name, totalsRowFunction: 'none' };
  });
  ws.addTable({ name: 'Table1', ref: 'A5', headerRow: true, totalsRow, columns, rows });
  below.forEach(([r, c, x]) => { ws.getRow(r).getCell(c).value = x; });
  ws.getCell('A5000').style = { font: { bold: true } }; // cellule formatée, sans valeur
  return wb.xlsx.writeBuffer();
}

/** Feuille « PDD base » sans tableau structuré : en-tête ligne 5, `cells` = [[ligne, valeurs]]. */
async function plainWorkbook(cells, { headers = HEADERS } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PDD base');
  ws.getRow(5).values = headers;
  for (const [r, values] of cells) ws.getRow(r).values = values;
  return wb.xlsx.writeBuffer();
}

const codes = (s) => s.issues.map((i) => i.code);

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
  assert.equal(p.blocking, 0);
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
  // Motifs structurés (code + paramètres) pour la traduction côté interface.
  const ref = p.skippedRows.find((s) => s.line === 8);
  assert.deepEqual(ref.issues, [{ code: 'EXCEL_ERROR', params: { error: '#REF!', col: 'AA', label: 'Riz' }, template: MESSAGES.EXCEL_ERROR }]);
  assert.equal(ref.month, '2025-10-01');
  // Toutes ces lignes sont d'octobre 2025, mois remplacé par l'import (ligne OK-1) : bloquantes.
  assert.equal(p.blocking, 10);
  assert.ok(p.skippedRows.every((s) => s.blocking));
  // La ligne sans année : mois incertain → bloquante, mois null.
  assert.equal(p.skippedRows.find((s) => s.line === 13).month, null);
});

test('lignes SOUS le tableau structuré : lues, écartées avec leur motif et comptées (jamais perdues en silence)', async () => {
  const buf = await realLikeWorkbook([line(), line({ commune: 'Ifotaka' })], {
    below: [[9, 1, 'Novembre'], [9, 16, 'Hors tableau'], ...line({ commune: 'Valide dessous' }).map((x, i) => [11, i + 1, x])],
  });
  const p = await parsePddWorkbook(buf);
  assert.equal(p.lastLine, 11);
  assert.deepEqual(p.rows.map((r) => r.commune), ['Ebelo', 'Ifotaka']);
  assert.equal(p.skipped, 2);
  assert.deepEqual(p.skippedRows.map((s) => s.line), [9, 11]);
  for (const s of p.skippedRows) {
    assert.deepEqual(codes(s), ['OUTSIDE_TABLE']);
    assert.match(s.message, /^Ligne hors du tableau Excel « Table1 » : étendez le tableau\.$/);
  }
  // Ligne 9 : mois sans année → mois illisible ; ligne 11 : octobre 2025, mois remplacé → bloquantes toutes deux.
  assert.equal(p.skippedRows[0].month, null);
  assert.equal(p.skippedRows[1].month, '2025-10-01');
  assert.equal(p.blocking, 2);
  assert.deepEqual(p.warnings, []);
});

test('tableau avec ligne de totaux : ni lue comme donnée, ni signalée à tort', async () => {
  const p = await parsePddWorkbook(await realLikeWorkbook([line(), line({ commune: 'Ifotaka' })], { totalsRow: true }));
  assert.deepEqual(p.rows.map((r) => r.commune), ['Ebelo', 'Ifotaka']);
  assert.equal(p.skipped, 0);
  assert.deepEqual(p.warnings, []);
  // Une ligne écrite APRÈS la ligne de totaux est, elle, hors du tableau.
  const q = await parsePddWorkbook(await realLikeWorkbook([line()], { totalsRow: true, below: [[9, 1, 'Novembre'], [9, 2, 2025]] }));
  assert.deepEqual(q.skippedRows.map((s) => [s.line, codes(s)[0]]), [[9, 'OUTSIDE_TABLE']]);
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

test('valeur isolée en ligne 1 048 000 sans tableau : aucune cellule créée, lecture en moins d\'une seconde', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PDD base');
  ws.getRow(5).values = HEADERS;
  ws.getRow(6).values = line();
  ws.getCell('A1048000').value = 'Octobre';
  const buf = await wb.xlsx.writeBuffer();
  const t0 = process.hrtime.bigint();
  const p = await parsePddWorkbook(buf);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 1000, `lecture en ${Math.round(ms)} ms`);
  assert.equal(p.lastLine, 1048000);
  assert.equal(p.rows.length, 1);
  assert.equal(p.skipped, 1);
  assert.equal(p.skippedRows[0].line, 1048000);
  assert.deepEqual(codes(p.skippedRows[0]), ['YEAR_MISSING', 'ACTIVITY_MISSING', 'ZONE_MISSING']);
  assert.equal(p.blocking, 1); // mois sans année : on ne peut pas l'écarter des mois remplacés
});

test('le parcours n\'appelle jamais actualRowCount / columnCount / getRow / getCell (pas de matérialisation)', async () => {
  const bufs = [
    await realLikeWorkbook([line(), line({ commune: 'Ifotaka' })], { below: [[9, 1, 'Novembre']] }),
    await plainWorkbook([[6, line()], [9, line({ commune: 'Dernière' })]]),
  ];
  const guarded = [[Worksheet.prototype, ['actualRowCount', 'columnCount', 'actualColumnCount', 'dimensions']],
    [Row.prototype, ['actualCellCount', 'dimensions']]];
  const saved = [];
  const forbid = (name) => () => { throw new Error(`${name} appelé pendant parsePddWorkbook`); };
  for (const [proto, names] of guarded) {
    for (const name of names) {
      saved.push([proto, name, Object.getOwnPropertyDescriptor(proto, name)]);
      Object.defineProperty(proto, name, { configurable: true, get: forbid(name) });
    }
  }
  const getRow = Worksheet.prototype.getRow; const getCell = Row.prototype.getCell;
  Worksheet.prototype.getRow = forbid('getRow'); Row.prototype.getCell = forbid('getCell');
  try {
    for (const buf of bufs) {
      const p = await parsePddWorkbook(buf);
      assert.ok(p.rows.length >= 1);
    }
  } finally {
    for (const [proto, name, desc] of saved) Object.defineProperty(proto, name, desc);
    Worksheet.prototype.getRow = getRow; Row.prototype.getCell = getCell;
  }
});

test('au-delà du plafond de lignes non vides : rien n\'est lu, refus explicite', async () => {
  const buf = await plainWorkbook([[6, line()], [7, line()], [8, line()], [9, line()]]);
  const p = await parsePddWorkbook(buf, { maxRows: 3 });
  assert.deepEqual(p.tooManyRows, { limit: 3, count: 4 });
  assert.equal(p.rows.length, 0);
  assert.equal((await parsePddWorkbook(buf, { maxRows: 4 })).rows.length, 4);
});

test('formule sans résultat enregistré sur une ligne remplie : écartée, avec le geste à faire', async () => {
  const p = await parsePddWorkbook(await plainWorkbook([
    [6, line({ over: { 41: { formula: 'SUM(AA6:AN6)' } } })],
    [7, line({ commune: { formula: 'VLOOKUP(Z7,X:Y,2,FALSE)' } })],
    [8, line({ commune: 'OK' })],
  ]));
  assert.deepEqual(p.rows.map((r) => r.commune), ['OK']);
  assert.match(p.skippedRows[0].message, /^Formule non calculée en colonne AO \(Total vivres\) : ouvrez et enregistrez le fichier dans Excel\.$/);
  assert.deepEqual(codes(p.skippedRows[1]), ['FORMULA_NOT_CALCULATED']);
  // Commune non calculée ET district vide : un seul motif, pas de « zone absente » en plus.
  const q = await parsePddWorkbook(await plainWorkbook([[6, line({ district: null, commune: { formula: 'VLOOKUP(Z6,X:Y,2,FALSE)' } })]]));
  assert.deepEqual(codes(q.skippedRows[0]), ['FORMULA_NOT_CALCULATED']);
});

test('formule dont le résultat enregistré vaut 0 : lue comme 0 (pas « non calculée »)', async () => {
  // Excel enregistre <f>…</f><v>0</v> ; `cell.value` d'exceljs omet ce résultat
  // « faux » — le classeur réel en contient des milliers (denrées à 0).
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PDD base');
  ws.getRow(5).values = HEADERS;
  ws.getRow(6).values = line({ over: { 27: { formula: 'IF(Y6="Riz",T6*0.5,0)' } } });
  ws.getCell('AA6')._value.model.result = 0; // ce qu'Excel écrit (inaccessible par l'API publique d'exceljs)
  const p = await parsePddWorkbook(await wb.xlsx.writeBuffer());
  assert.equal(p.skipped, 0, JSON.stringify(p.skippedRows));
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].items.Riz, undefined);
});

test('lignes sans mois, activité ni zone mais en erreur Excel : un avertissement groupé', async () => {
  const errRow = (r) => { const v = new Array(47).fill(null); v[15] = { formula: `VLOOKUP(Q${r},X:Y,2,FALSE)`, result: { error: '#N/A' } }; v[20] = { error: '#REF!' }; return v; };
  const p = await parsePddWorkbook(await plainWorkbook([[6, line()], [7, errRow(7)], [8, errRow(8)], [12, errRow(12)]]));
  assert.equal(p.rows.length, 1);
  assert.equal(p.skipped, 0);
  assert.equal(p.warnings.length, 1);
  const [w] = p.warnings;
  assert.equal(w.code, 'ERROR_ROWS_WITHOUT_IDENTITY');
  assert.deepEqual(w.params, { n: 3, errors: '#N/A, #REF!', from: 7, to: 12 });
  assert.equal(w.line, 7);
  assert.match(w.message, /^3 ligne\(s\) sans mois, activité ni zone portent des erreurs Excel \(#N\/A, #REF!\) : non importées \(lignes 7 à 12\)\.$/);
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
  assert.ok(p.layoutIssues.some((m) => /colonne P/.test(m.message) && m.code === 'LAYOUT_HEADER'));
});

test('colonne AQ : le cash doit être en USD (en-tête « usd »), jamais en ariary', () => {
  const at = (over) => (c) => (c in over ? over[c] : HEADERS[c - 1]);
  assert.deepEqual(layoutIssues(at({})), []);
  assert.deepEqual(layoutIssues(at({ [COL.cashUsd]: 'Cash (USD)' })), []); // en-tête du modèle MEMS
  const mga = layoutIssues(at({ [COL.cashUsd]: 'Cash-MGA' }));
  assert.deepEqual(mga.map((i) => [i.code, i.params.col]), [['LAYOUT_CASH_CURRENCY', 'AQ']]);
  assert.deepEqual(layoutIssues(at({ [COL.cashUsd]: 'Cash USD (Ariary converti)' })).map((i) => i.code), ['LAYOUT_CASH_CURRENCY']);
  assert.deepEqual(layoutIssues(at({ [COL.cashUsd]: 'Cash' })).map((i) => i.code), ['LAYOUT_HEADER']); // devise absente
  const empty = layoutIssues(at({ [COL.cashUsd]: null }));
  assert.deepEqual(empty.map((i) => i.message), ['colonne AQ : en-tête vide au lieu de « Cash USD »']);
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

test('parseMonth : abréviations FR/EN sans ambiguïté acceptées, ambiguës refusées', () => {
  const ok = { janv: 1, 'Jan.': 1, fev: 2, 'fév.': 2, 'févr.': 2, Feb: 2, avr: 4, apr: 4, 'juil.': 7, jul: 7, aug: 8,
    sept: 9, 'Sep': 9, oct: 10, NOV: 11, dec: 12, 'déc.': 12, 'oct. 2025': 10 };
  for (const [s, m] of Object.entries(ok)) assert.equal(parseMonth(s).month, m, s);
  assert.deepEqual(parseMonth('déc 2025'), { month: 12, year: 2025 });
  for (const s of ['jui', 'ju', 'ma', 'j', 'octo-bre']) assert.ok(parseMonth(s).unknown, s);
});

test('parseMonth / parseYear : date hors 2000–2100 invalide (ex. nombre mis au format date)', () => {
  assert.deepEqual(parseMonth(new Date(Date.UTC(1900, 0, 10))), { invalid: '1900-01-10' });
  assert.deepEqual(parseMonth(new Date(Date.UTC(2101, 0, 1))), { invalid: '2101-01-01' });
  assert.deepEqual(parseMonth('Octobre 1999'), { invalid: 'Octobre 1999' });
  assert.deepEqual(parseYear(new Date(Date.UTC(1905, 6, 17))), { invalid: '1905-07-17' });
  assert.deepEqual(parseYear(new Date(Date.UTC(2026, 0, 1))), { year: 2026 });
  const base = { 1: 'Octobre', 2: 2025, 7: 'GD drought', 15: 'Amboasary', 16: 'Ebelo', 20: 100 };
  const at = (over) => (c) => (c in over ? over[c] : (base[c] ?? null));
  const r = parsePddRow(at({ 1: new Date(Date.UTC(1900, 0, 10)) }), 6);
  assert.deepEqual(r.skip.issues.map((i) => i.code), ['MONTH_OUT_OF_RANGE']);
  assert.equal(r.skip.month, null);
  assert.match(parsePddRow(at({ 2: new Date(Date.UTC(1905, 6, 17)) }), 7).skip.message, /année invalide « 1905-07-17 »/i);
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

test('cellValue / toNumber : erreurs Excel isolées, formule non calculée signalée, nombres stricts', () => {
  assert.deepEqual(cellValue({ error: '#REF!' }), { error: '#REF!' });
  assert.deepEqual(cellValue({ formula: 'A1/0', result: { error: '#DIV/0!' } }), { error: '#DIV/0!' });
  assert.deepEqual(cellValue(' #N/A '), { error: '#N/A' }); // erreur collée comme texte
  assert.equal(cellValue({ formula: 'A1*2', result: 4 }), 4);
  assert.deepEqual(cellValue({ formula: 'A1*2' }), { notCalculated: true }); // pas de résultat en cache
  assert.deepEqual(cellValue({ sharedFormula: 'A1' }), { notCalculated: true });
  assert.equal(cellValue({ richText: [{ text: 'Ebe' }, { text: 'lo' }] }), 'Ebelo');
  assert.equal(toNumber('1 250,5'), 1250.5);
  assert.equal(toNumber('0,250'), 0.25); // « 0,250 » ne peut pas être un séparateur de milliers
  assert.equal(toNumber('1,25'), 1.25);
  assert.equal(toNumber(12), 12);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber('-'), null);
  assert.ok(Number.isNaN(toNumber('abc')));
  assert.ok(Number.isNaN(toNumber('1,250.5'))); // séparateurs mêlés : jamais deviné
  assert.ok(Number.isNaN(toNumber('1,250'))); // 1 250 ou 1,25 ? jamais deviné
  assert.ok(Number.isNaN(toNumber('-12,500')));
  // Même ambiguïté avec le point : « 1.250 » = 1 250 (milliers à la française) ou 1,25 ?
  assert.ok(Number.isNaN(toNumber('1.250')));
  assert.ok(Number.isNaN(toNumber('12.345')));
  assert.equal(toNumber('0.250'), 0.25); // « 0.250 » ne peut pas être un séparateur de milliers
  assert.equal(toNumber('1.25'), 1.25);
  assert.equal(toNumber('1250.500'), 1250.5); // 4 chiffres avant le point : pas un séparateur de milliers
  assert.ok(Number.isNaN(toNumber(true)));
});

test('nombre ambigu « 1.250 » (texte) : jamais lu 1,25 en silence — ligne écartée avec le motif dédié', () => {
  const base = { 1: 'Octobre', 2: 2025, 7: 'GD drought', 15: 'Amboasary', 16: 'Ebelo', 20: '1.250' };
  const r = parsePddRow((c) => base[c] ?? null, 6);
  assert.equal(r.row, undefined);
  assert.deepEqual(r.skip.issues.map((i) => [i.code, i.params.value]), [['AMBIGUOUS_NUMBER', '1.250']]);
});

test('nombre ambigu « 1,250 » : ligne écartée avec un motif dédié', () => {
  const base = { 1: 'Octobre', 2: 2025, 7: 'GD drought', 15: 'Amboasary', 16: 'Ebelo', 20: '1,250' };
  const r = parsePddRow((c) => base[c] ?? null, 6);
  assert.deepEqual(r.skip.issues, [{ code: 'AMBIGUOUS_NUMBER', params: { value: '1,250', col: 'T', label: 'Bénéficiaires' }, template: MESSAGES.AMBIGUOUS_NUMBER }]);
  assert.match(r.skip.message, /^Nombre ambigu « 1,250 » en colonne T \(Bénéficiaires\)/);
});

test('parsePddRow : ligne vide ignorée sans être comptée', () => {
  assert.deepEqual(parsePddRow(() => null, 10), { empty: true });
  // Formule sans résultat (ex. total d'une ligne de saisie vide du modèle) : vide aussi.
  assert.deepEqual(parsePddRow((c) => (c === 41 ? { formula: 'SUM(AA10:AN10)' } : null), 10), { empty: true });
  // Seules des erreurs Excel : vide, mais ses erreurs sont remontées (avertissement groupé).
  assert.deepEqual(parsePddRow((c) => (c === 16 ? { error: '#N/A' } : null), 10), { empty: true, errors: ['#N/A'] });
  // Des chiffres sans mois ni zone : ce n'est pas une ligne vide, elle est signalée.
  const r = parsePddRow((c) => (c === 20 ? 120 : null), 11);
  assert.equal(r.skip.line, 11);
  assert.match(r.skip.message, /mois absent/i);
});

test('parsePddRow : année portée par le mois, année incohérente ou invalide, valeur hors limites', () => {
  const base = { 1: 'Octobre', 2: 2025, 7: 'GD drought', 15: 'Amboasary', 16: 'Ebelo', 20: 100 };
  const at = (over) => (c) => (c in over ? over[c] : (base[c] ?? null));
  assert.equal(parsePddRow(at({ 1: 'Octobre 2025', 2: null }), 6).row.periodMonth, '2025-10-01');
  const mismatch = parsePddRow(at({ 1: new Date(Date.UTC(2026, 0, 1)), 2: 2025 }), 7).skip;
  assert.match(mismatch.message, /année incohérente \(2025 en colonne B \(Année\), 2026 dans le mois\)/i);
  assert.equal(mismatch.month, null); // quel mois ? incertain
  assert.match(parsePddRow(at({ 43: 5e12 }), 8).skip.message, /hors limites/);
  assert.match(parsePddRow(at({ 2: 25 }), 9).skip.message, /année invalide « 25 »/i);
});

test('markBlocking : bloquante si le mois est remplacé par l\'import ou illisible', () => {
  const skipped = [{ line: 6, month: '2025-10-01' }, { line: 7, month: '2025-12-01' }, { line: 8, month: null }];
  assert.equal(markBlocking(skipped, ['2025-10-01', '2025-11-01']), 2);
  assert.deepEqual(skipped.map((s) => s.blocking), [true, false, true]);
});

test('chaque motif a sa traduction anglaise (web/src/locales/en/pdd.js)', (t) => {
  const file = path.join(__dirname, '../../web/src/locales/en/pdd.js');
  if (!fs.existsSync(file)) { t.skip('interface absente'); return; }
  const src = fs.readFileSync(file, 'utf8');
  for (const [code, template] of Object.entries(MESSAGES)) {
    assert.ok(src.includes(`'${template}'`) || src.includes(`"${template}"`), `${code} : « ${template} » sans entrée anglaise`);
  }
  // Libellés de colonnes passés en paramètre `label` : traduits eux aussi.
  for (const label of ['Bénéficiaires', 'Ménages', 'Modalité', 'Total vivres', 'Cash USD', 'Riz', 'Huile']) {
    assert.ok(src.includes(`'${label}'`), `libellé « ${label} » sans entrée anglaise`);
  }
});
