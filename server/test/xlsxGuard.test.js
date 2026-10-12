const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');
const { loadWorkbook, refArea, mergedCellsInXml, MAX_MERGED_CELLS } = require('../src/modules/common/xlsxGuard');

/** Petit classeur réel, dont on retouche le XML de la feuille (après </sheetData>). */
async function workbookWith(extraXml) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Données');
  ws.addRow(['Code', 'Nom']);
  ws.addRow(['MG51', 'Atsimo-Andrefana']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  if (!extraXml) return buf;
  const zip = new AdmZip(buf);
  const name = 'xl/worksheets/sheet1.xml';
  const xml = zip.readAsText(name).replace('</sheetData>', `</sheetData>${extraXml}`);
  zip.updateFile(name, Buffer.from(xml, 'utf8'));
  return zip.toBuffer();
}

test('surface d\'une référence : cellule, plage, colonnes à plusieurs lettres, illisible', () => {
  assert.equal(refArea('B2'), 1);
  assert.equal(refArea('A1:C3'), 9);
  assert.equal(refArea('$A$6:$AQ$1048576'), 43 * 1048571);
  assert.equal(refArea('C3:A1'), 9);
  assert.equal(refArea('n/a'), 0);
});

test('cellules fusionnées comptées dans le XML (préfixe d\'espace de noms compris)', () => {
  assert.equal(mergedCellsInXml('<sheetData/>'), 0);
  assert.equal(mergedCellsInXml('<sheetData/><mergeCells count="2"><mergeCell ref="A1:B2"/><mergeCell ref="D4"/></mergeCells>'), 5);
  assert.equal(mergedCellsInXml('<x:mergeCells><x:mergeCell ref="A1:A10"/></x:mergeCells>'), 10);
});

test('classeur de quelques Ko fusionnant A6:AQ1048576 : refusé en un instant, sans être chargé', async () => {
  const buf = await workbookWith('<mergeCells count="1"><mergeCell ref="A6:AQ1048576"/></mergeCells>');
  assert.ok(buf.length < 20000);
  const t0 = Date.now();
  await assert.rejects(loadWorkbook(buf), (e) => e.statusCode === 400 && /fusionne plus de/.test(e.message));
  assert.ok(Date.now() - t0 < 2000);
});

test('validation de données sur une colonne entière : chargé vite, valeurs intactes', async () => {
  const buf = await workbookWith('<dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="A1:A1048576"><formula1>"a,b"</formula1></dataValidation></dataValidations>');
  const t0 = Date.now();
  const wb = await loadWorkbook(buf);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(wb.worksheets[0].getCell('B2').value, 'Atsimo-Andrefana');
});

test('fusions ordinaires (modèles réels : quelques milliers de cellules) : acceptées, valeur de la cellule maîtresse lue', async () => {
  const buf = await workbookWith('<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>');
  const wb = await loadWorkbook(buf);
  assert.equal(wb.worksheets[0].getCell('A1').value, 'Code');
  assert.ok(MAX_MERGED_CELLS >= 50000);
});

test('archive qui annonce trop de données décompressées : 413 avant tout chargement', async () => {
  const buf = await workbookWith();
  await assert.rejects(loadWorkbook(buf, { zipLimits: { maxBytes: 100, maxRatio: 100, ratioFloorBytes: 10 } }), (e) => e.statusCode === 413);
});
