const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { loadWorkbook, scanSheetXml, MAX_CELL_SLOTS } = require('../src/modules/common/xlsxGuard');
const { sheetTable, filledWidth, rowValues, existingRows } = require('../src/modules/common/sheetRows');
const { parseMmrWorkbook } = require('../src/modules/tpm/mmrXlsx');
const { parseLocationsWorkbook } = require('../src/modules/tpm/locationsXlsx');
const { parseSubmissions } = require('../src/modules/monitoring/submissionsImport');

/** Classeur en mémoire : [{ name, cells: [[adresse, valeur], …] }]. */
async function book(sheets) {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    for (const [addr, v] of s.cells) ws.getCell(addr).value = v;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('places de cellules : dernière colonne occupée de chaque ligne, cellules sans référence, hors ligne ignorées', () => {
  const xml = '<sheetData><row r="1"><c r="A1"/><c r="C1"/></row><row r="2"><c r="XFD2"><v>1</v></c></row>'
    + '<row r="3"><c/><c/></row></sheetData><x:row><x:c r="&#88;FD4"/></x:row>';
  assert.equal(scanSheetXml(xml).cellSlots, 3 + 16384 + 2 + 16384);
  assert.equal(scanSheetXml('<calcChain><c r="XFD1" i="1"/></calcChain>').cellSlots, 0);
  assert.equal(scanSheetXml('<c:chart><c:plotArea/></c:chart>').cellSlots, 0);
  assert.match(scanSheetXml('<row><c r="XFE1"/></row>').unreadable, /hors limites/);
});

test('lignes ne contenant qu\'une cellule tout à droite : classeur refusé avant chargement (400), en un instant', async () => {
  const rows = Math.ceil(MAX_CELL_SLOTS / 16384) + 10;
  const cells = [['A1', 'Nom']];
  for (let r = 2; r <= rows; r += 1) cells.push([`XFD${r}`, 'x']);
  const buf = await book([{ name: 'Feuille', cells }]);
  const t0 = Date.now();
  await assert.rejects(loadWorkbook(buf), (e) => e.statusCode === 400 && /s'étendent sur plus de/.test(e.message));
  assert.ok(Date.now() - t0 < 3000);
  await assert.rejects(parseSubmissions(buf), (e) => e.statusCode === 400);
});

test('tableau d\'une feuille : largeur de l\'en-tête, lignes vides sautées, valeur au-delà ignorée', async () => {
  const buf = await book([{ name: 'choices', cells: [
    ['A2', 'list_name'], ['B2', 'name'], ['C2', 'label'],
    ['A3', 'adm1'], ['B3', 'MG11'], ['C3', 'Analamanga'], ['XFD3', 'parasite'],
    ['A5', 'adm1'], ['B5', 'MG12'], ['C5', 'Vakinankaratra'],
  ] }]);
  const ws = (await loadWorkbook(buf)).worksheets[0];
  const rows = sheetTable(ws);
  assert.deepEqual(rows.map((r) => r.length), [3, 3, 3]);
  assert.deepEqual(rows[1], ['adm1', 'MG11', 'Analamanga']);
  assert.deepEqual([...existingRows(ws)].map((x) => x.r), [2, 3, 5]);
  assert.deepEqual(filledWidth(ws.findRow(3), 1024), { width: 3, beyond: true });
  const r5 = rowValues(ws.findRow(5), 4);
  assert.equal(r5.length, 4);
  assert.deepEqual(r5.slice(0, 3), ['adm1', 'MG12', 'Vakinankaratra']);
});

test('en-tête de plus de 1 024 colonnes : feuille refusée (400) au lieu de lire 16 384 colonnes par ligne', async () => {
  const buf = await book([{ name: 'survey', cells: [['A1', 'type'], ['XFD1', 'name'], ['A2', 'text']] }]);
  const ws = (await loadWorkbook(buf)).worksheets[0];
  assert.throws(() => sheetTable(ws), (e) => e.statusCode === 400 && /1\s024 colonnes/.test(e.message));
});

test('MMR et registre des sites : des lignes vides dans le tableau ne font perdre aucune ligne', async () => {
  const mmr = [['A1', 'Activity category'], ['B1', 'Operation duration'], ['C1', 'Risk level']];
  for (const r of [2, 3, 4, 8, 9, 10]) mmr.push([`A${r}`, `Cat ${r}`], [`B${r}`, 3], [`C${r}`, 1]);
  const m = await parseMmrWorkbook(await book([{ name: 'Paramètres MMR', cells: mmr }]), []);
  assert.deepEqual(m.rows.map((x) => x.activityCategory), ['Cat 2', 'Cat 3', 'Cat 4', 'Cat 8', 'Cat 9', 'Cat 10']);

  const loc = [['A1', 'ID'], ['B1', 'Point of interest'], ['C1', 'Activity tag'], ['D1', 'Sub Office']];
  for (const r of [2, 3, 4, 5, 14, 15, 16, 17, 18, 19, 20]) loc.push([`A${r}`, `L${String(r).padStart(3, '0')}`], [`B${r}`, `Site ${r}`], [`C${r}`, 'GD']);
  const l = await parseLocationsWorkbook(await book([{ name: 'Locations Management', cells: loc }]), { resolveOffice: () => null, activities: [] });
  assert.equal(l.rows.length, 11);
  assert.equal(l.rows.at(-1).line, 20);
});

test('relecture 2 : une fusion verticale tout à droite compte toutes ses lignes dans le budget de places', () => {
  const { scanSheetXml: scan } = require('../src/modules/common/xlsxGuard');
  assert.equal(scan('<mergeCells><mergeCell ref="XFD1:XFD100"/></mergeCells>').cellSlots, 100 * 16384);
  // Un « > » dans une valeur entre guillemets ne cache pas la référence de la cellule.
  assert.equal(scan('<row r="1"><c t="a>b" r="XFD1"/></row>').cellSlots, 16384);
});

test('relecture 2 : un identifiant « uuid: » vide passe à la colonne suivante (_id) ; caractère nul retiré', async () => {
  const csv = Buffer.from('_uuid,_id,today,note\nuuid:,101,2026-01-15,a\nuuid:,102,2026-02-15,c\n');
  const out = await parseSubmissions(csv);
  assert.deepEqual(out.submissions.map((s) => s.externalId), ['101', '102']);
  // Caractère nul d'une source JSON (Kobo) ou d'un .xlsx (_x0000_) : retiré (PostgreSQL le refuse dans un jsonb).
  const { submissionsFromObjects } = require('../src/modules/monitoring/submissionsImport');
  const [sub] = submissionsFromObjects([{ _uuid: 'u1', today: '2026-01-15', note: 'a\u0000b' }]);
  assert.equal(sub.data.note, 'ab');
});

test('relecture 3 : un guillemet ouvert dans un commentaire ne masque aucune balise ; « r » lu parmi les attributs', () => {
  const { scanSheetXml: scan } = require('../src/modules/common/xlsxGuard');
  const hidden = scan('<!--<row \'--><sheetData><row r="1"/></sheetData><mergeCells><mergeCell ref="A7:XFD1048576"/></mergeCells><!--\'-->');
  assert.ok(hidden.merged > 1e9, 'la zone fusionnée reste comptée');
  assert.equal(scan('<row r="1" x=\'><mergeCell ref="A1:XFD100"/>').merged, 1638400);
  assert.equal(scan('<row r="2"><c foo=" r=\'A2\'" r="XFD2">x</c></row>').cellSlots, 16384);
});
